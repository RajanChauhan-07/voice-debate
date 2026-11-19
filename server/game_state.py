import asyncio
import time
import uuid
from typing import Dict, Any, List, Optional, Callable
from server.topics import get_debate_topic
from server.evaluation import evaluate_debate, check_vocabulary_hints
from server.db import save_match_result, update_user_rating
from server.config import (
    TURN_DURATION_SECONDS,
    COIN_TOSS_DURATION_SECONDS,
    TOPIC_REVEAL_DURATION_SECONDS
)

class DebateTurn:
    def __init__(self, index: int, name: str, speaker_key: str, duration: int):
        self.index = index
        self.name = name
        self.speaker_key = speaker_key  # 'player_a' or 'player_b'
        self.duration = duration
        self.transcript = ""

class DebateRoom:
    def __init__(
        self,
        room_id: str,
        player_a: Dict[str, Any],
        player_b: Dict[str, Any],
        broadcast_fn: Callable[[str, Dict[str, Any]], Any],
        is_bot_match: bool = False
    ):
        self.room_id = room_id
        self.player_a = player_a
        self.player_b = player_b
        self.broadcast_fn = broadcast_fn
        self.is_bot_match = is_bot_match

        self.state = "MATCHED"  # MATCHED -> TOPIC_REVEAL -> COIN_TOSS -> TURN_1..4 -> EVALUATING -> RESULTS
        self.topic: Dict[str, Any] = {}
        self.mandatory_vocabulary: List[str] = []

        # Turn definitions (Four 45-second turns = 3 minutes)
        self.turns: List[DebateTurn] = [
            DebateTurn(1, "Motion / Opening", "player_a", TURN_DURATION_SECONDS),
            DebateTurn(2, "Constructive Speech", "player_b", TURN_DURATION_SECONDS),
            DebateTurn(3, "Rebuttal", "player_a", TURN_DURATION_SECONDS),
            DebateTurn(4, "Closing Summary", "player_b", TURN_DURATION_SECONDS),
        ]
        self.current_turn_idx = -1
        self.turn_time_remaining = 0
        self.timer_task: Optional[asyncio.Task] = None
        self.is_active = True
        self.matched_at = time.time()
        self.evaluation_result: Optional[Dict[str, Any]] = None

    def get_player(self, user_id: str) -> Optional[Dict[str, Any]]:
        if self.player_a.get("id") == user_id:
            return self.player_a
        if self.player_b.get("id") == user_id:
            return self.player_b
        return None

    def get_opponent(self, user_id: str) -> Optional[Dict[str, Any]]:
        if self.player_a.get("id") == user_id:
            return self.player_b
        if self.player_b.get("id") == user_id:
            return self.player_a
        return None

    async def start(self):
        """Kicks off the room lifecycle."""
        # 1. Announce match
        await self.broadcast_fn(self.room_id, {
            "type": "match_found",
            "room_id": self.room_id,
            "player_a": self.player_a,
            "player_b": self.player_b
        })

        await asyncio.sleep(2.0)

        # 2. Topic Reveal
        self.state = "TOPIC_REVEAL"
        self.topic = await get_debate_topic()
        self.mandatory_vocabulary = self.topic.get("mandatory_vocabulary", [])

        # Assign sides
        self.player_a["side"] = "FOR"
        self.player_b["side"] = "AGAINST"

        await self.broadcast_fn(self.room_id, {
            "type": "topic_reveal",
            "topic": self.topic,
            "player_a_side": "FOR",
            "player_b_side": "AGAINST",
            "mandatory_vocabulary": self.mandatory_vocabulary,
            "duration": TOPIC_REVEAL_DURATION_SECONDS
        })

        await asyncio.sleep(TOPIC_REVEAL_DURATION_SECONDS)

        # 3. Coin Toss
        self.state = "COIN_TOSS"
        first_speaker = "player_a"
        await self.broadcast_fn(self.room_id, {
            "type": "coin_toss",
            "first_speaker": first_speaker,
            "first_speaker_name": self.player_a["display_name"],
            "duration": COIN_TOSS_DURATION_SECONDS
        })

        await asyncio.sleep(COIN_TOSS_DURATION_SECONDS)

        # 4. Begin Debate Turns
        await self.next_turn()

    async def next_turn(self):
        """Advances to the next speaking turn or triggers evaluation."""
        self.current_turn_idx += 1

        if self.current_turn_idx >= len(self.turns):
            # All 4 turns completed -> AI Evaluation
            await self.trigger_evaluation()
            return

        current_turn = self.turns[self.current_turn_idx]
        active_player = self.player_a if current_turn.speaker_key == "player_a" else self.player_b
        listening_player = self.player_b if current_turn.speaker_key == "player_a" else self.player_a

        self.turn_time_remaining = current_turn.duration
        self.state = f"TURN_{current_turn.index}"

        # Total remaining debate time
        total_remaining = sum(t.duration for t in self.turns[self.current_turn_idx:])

        await self.broadcast_fn(self.room_id, {
            "type": "turn_start",
            "turn_index": current_turn.index,
            "total_turns": len(self.turns),
            "turn_name": current_turn.name,
            "speaker_id": active_player["id"],
            "speaker_name": active_player["display_name"],
            "speaker_side": active_player["side"],
            "active_speaker_key": current_turn.speaker_key,
            "duration": current_turn.duration,
            "total_debate_remaining": total_remaining,
            # Server-authoritative mic permission
            "mic_enabled_user_id": active_player["id"]
        })

        # Start timer loop
        if self.timer_task and not self.timer_task.done():
            self.timer_task.cancel()
        self.timer_task = asyncio.create_task(self._run_turn_timer())

    async def _run_turn_timer(self):
        try:
            current_turn = self.turns[self.current_turn_idx]

            while self.turn_time_remaining > 0 and self.is_active:
                await asyncio.sleep(1.0)
                self.turn_time_remaining -= 1

                # Calculate total remaining
                total_remaining = self.turn_time_remaining + sum(
                    t.duration for t in self.turns[self.current_turn_idx + 1:]
                )

                await self.broadcast_fn(self.room_id, {
                    "type": "timer_tick",
                    "turn_index": current_turn.index,
                    "turn_time_remaining": self.turn_time_remaining,
                    "total_debate_remaining": total_remaining
                })

            if self.is_active:
                await self.next_turn()
        except asyncio.CancelledError:
            pass

    async def handle_transcript_update(self, user_id: str, text: str, is_final: bool):
        """Handles live streaming transcript from active speaker."""
        if self.current_turn_idx < 0 or self.current_turn_idx >= len(self.turns):
            return

        current_turn = self.turns[self.current_turn_idx]
        active_player = self.player_a if current_turn.speaker_key == "player_a" else self.player_b

        # Verify caller is active speaker
        if active_player["id"] != user_id:
            return

        if is_final:
            current_turn.transcript = (current_turn.transcript + " " + text).strip()
        else:
            # Interim live preview
            pass

        # Check which mandatory vocabulary words were spoken
        combined_text = current_turn.transcript + (" " + text if not is_final else "")
        hints_status = check_vocabulary_hints(combined_text, self.mandatory_vocabulary)

        # Broadcast live transcript & hint updates to both debaters
        await self.broadcast_fn(self.room_id, {
            "type": "live_transcript",
            "turn_index": current_turn.index,
            "speaker_id": user_id,
            "interim_text": text,
            "full_turn_transcript": current_turn.transcript,
            "is_final": is_final,
            "hints_status": hints_status
        })

    async def skip_turn(self):
        """Allows testing skip turn immediately."""
        if self.timer_task and not self.timer_task.done():
            self.timer_task.cancel()
        await self.next_turn()

    async def trigger_evaluation(self):
        """Transcribes and evaluates both speeches with Gemini/Rubric."""
        self.state = "EVALUATING"
        if self.timer_task and not self.timer_task.done():
            self.timer_task.cancel()

        await self.broadcast_fn(self.room_id, {
            "type": "evaluation_start",
            "message": "AI is transcribing turns and evaluating English & Debating abilities..."
        })

        # Separate transcripts by player
        turns_a = []
        turns_b = []
        all_turns_records = []

        for t in self.turns:
            rec = {
                "turn_index": t.index,
                "turn_name": t.name,
                "speaker_key": t.speaker_key,
                "speaker_id": self.player_a["id"] if t.speaker_key == "player_a" else self.player_b["id"],
                "speaker_side": "FOR" if t.speaker_key == "player_a" else "AGAINST",
                "transcript": t.transcript.strip()
            }
            all_turns_records.append(rec)
            if t.speaker_key == "player_a":
                turns_a.append(rec)
            else:
                turns_b.append(rec)

        # Run evaluation
        eval_result = await evaluate_debate(
            self.topic.get("motion", "Debate"),
            self.mandatory_vocabulary,
            self.player_a,
            self.player_b,
            turns_a,
            turns_b
        )
        self.evaluation_result = eval_result
        self.state = "RESULTS"

        # Update SQLite DB stats
        rating_changes = eval_result.get("rating_changes", {})
        delta_a = rating_changes.get("player_a", {}).get("delta", 0)
        delta_b = rating_changes.get("player_b", {}).get("delta", 0)
        winner_id = eval_result.get("winner_id")

        a_eng = eval_result["player_a"]["english_proficiency"]
        a_deb = eval_result["player_a"]["debating_proficiency"]
        b_eng = eval_result["player_b"]["english_proficiency"]
        b_deb = eval_result["player_b"]["debating_proficiency"]

        # Persist ratings
        if not self.is_bot_match:
            update_user_rating(self.player_a["id"], rating_changes["player_a"]["new_rating"], winner_id == self.player_a["id"], a_eng, a_deb)
            update_user_rating(self.player_b["id"], rating_changes["player_b"]["new_rating"], winner_id == self.player_b["id"], b_eng, b_deb)

        save_match_result(
            match_id=f"match-{uuid.uuid4().hex[:10]}",
            room_id=self.room_id,
            player_a_id=self.player_a["id"],
            player_b_id=self.player_b["id"],
            topic=self.topic,
            winner_id=winner_id,
            a_eng=a_eng,
            a_deb=a_deb,
            b_eng=b_eng,
            b_deb=b_deb,
            delta_a=delta_a,
            delta_b=delta_b,
            evaluation=eval_result,
            turns=all_turns_records
        )

        # Broadcast results to participants
        await self.broadcast_fn(self.room_id, {
            "type": "debate_results",
            "evaluation": eval_result,
            "turns": all_turns_records,
            "topic": self.topic
        })

    def close(self):
        self.is_active = False
        if self.timer_task and not self.timer_task.done():
            self.timer_task.cancel()

