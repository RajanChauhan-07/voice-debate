import asyncio
import sys
from server.db import init_db, get_or_create_user, get_leaderboard
from server.topics import get_debate_topic
from server.evaluation import rubric_evaluate_speech, calculate_elo, check_vocabulary_hints
from server.game_state import DebateRoom

async def run_all_tests():
    print("==================================================")
    print(" RUNNING VOICEDEBATE ARENA VERIFICATION SUITE")
    print("==================================================")

    # 1. Test Database
    print("\n[1/5] Testing SQLite Database Initialization...")
    init_db()
    user1 = get_or_create_user("alex_c", "Alex Chen")
    user2 = get_or_create_user("jordan_b", "Jordan Blake")
    assert user1["id"] is not None
    assert user2["id"] is not None
    leaderboard = get_leaderboard(5)
    assert len(leaderboard) >= 2
    print(f"  ✓ User 1 created: {user1['display_name']} (Rating: {user1['rating']})")
    print(f"  ✓ User 2 created: {user2['display_name']} (Rating: {user2['rating']})")
    print(f"  ✓ Leaderboard seeded with {len(leaderboard)} debaters.")

    # 2. Test Topics
    print("\n[2/5] Testing Debate Topics & Vocabulary Hints...")
    topic = await get_debate_topic()
    assert "motion" in topic
    assert "mandatory_vocabulary" in topic
    assert len(topic["mandatory_vocabulary"]) == 5
    print(f"  ✓ Motion: \"{topic['motion']}\"")
    print(f"  ✓ 5 Mandatory Words: {topic['mandatory_vocabulary']}")

    # 3. Test Vocabulary Hint Detection
    print("\n[3/5] Testing Spoken Vocabulary Hint Detection...")
    matching_speech = f"We believe in {topic['mandatory_vocabulary'][0].lower()} and {topic['mandatory_vocabulary'][1].lower()}."
    hints_result = check_vocabulary_hints(matching_speech, topic["mandatory_vocabulary"])
    used_words = [h["word"] for h in hints_result if h["used"]]
    print(f"  ✓ Sample Speech: \"{matching_speech}\"")
    print(f"  ✓ Detected {len(used_words)} used hints: {used_words}")
    assert len(used_words) == 2


    # 4. Test Evaluation & Scoring Rubric
    print("\n[4/5] Testing Deterministic Scoring Rubric & Elo...")
    turns_a = [{
        "turn_index": 1,
        "transcript": "First, innovation in educational algorithms enables personalized learning because each student progresses at their own pace. Empathy remains crucial, but efficiency will democratize access."
    }]
    turns_b = [{
        "turn_index": 2,
        "transcript": "My opponent claims efficiency justifies replacing human educators. However, accountability and critical thinking cannot be instilled without real human mentorship."
    }]

    eval_a = rubric_evaluate_speech(
        user1["id"], user1["display_name"], "FOR",
        turns_a, turns_b, topic["mandatory_vocabulary"], topic["motion"]
    )
    eval_b = rubric_evaluate_speech(
        user2["id"], user2["display_name"], "AGAINST",
        turns_b, turns_a, topic["mandatory_vocabulary"], topic["motion"]
    )

    print(f"  ✓ Player A - English Score: {eval_a['english_proficiency']}/100, Debate Score: {eval_a['debating_proficiency']}/100")
    print(f"  ✓ Player B - English Score: {eval_b['english_proficiency']}/100, Debate Score: {eval_b['debating_proficiency']}/100")
    print(f"  ✓ Player A Grammar Corrections: {len(eval_a['grammar_corrections'])} suggestions")
    print(f"  ✓ Player A Coaching Points: {len(eval_a['suggestions'])} items")

    delta_a, delta_b = calculate_elo(user1["rating"], user2["rating"], "player_a")
    print(f"  ✓ Elo Change (Player A wins): Player A +{delta_a}, Player B {delta_b}")
    assert delta_a > 0
    assert delta_b < 0

    # 5. Test Game Room State Machine
    print("\n[5/5] Testing Debate Room State Machine & Turns...")
    messages_received = []
    async def mock_broadcast(room_id, msg):
        messages_received.append(msg["type"])

    p_a = {"id": user1["id"], "display_name": user1["display_name"], "rating": user1["rating"]}
    p_b = {"id": user2["id"], "display_name": user2["display_name"], "rating": user2["rating"]}

    room = DebateRoom("room-test-1", p_a, p_b, mock_broadcast)
    # Test turn progression
    room.topic = topic
    room.mandatory_vocabulary = topic["mandatory_vocabulary"]
    p_a["side"] = "FOR"
    p_b["side"] = "AGAINST"

    await room.next_turn()
    assert room.current_turn_idx == 0
    assert "turn_start" in messages_received
    print(f"  ✓ Turn 1 ({room.turns[0].name}) successfully activated for {p_a['display_name']}")

    # Test live transcript streaming
    await room.handle_transcript_update(user1["id"], "Testing live streaming words innovation", True)
    assert "live_transcript" in messages_received
    print("  ✓ Live transcript update verified.")

    room.close()
    print("\n==================================================")
    print(" ✅ ALL TEST SUITES PASSED PERFECTLY!")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_all_tests())
