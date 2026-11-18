import asyncio
import uuid
import random
from typing import Dict, Any, List, Optional, Callable
from server.game_state import DebateRoom

class MatchmakingManager:
    def __init__(self, broadcast_fn: Callable[[str, Dict[str, Any]], Any], send_direct_fn: Callable[[str, Dict[str, Any]], Any]):
        self.broadcast_fn = broadcast_fn
        self.send_direct_fn = send_direct_fn
        self.queue: List[Dict[str, Any]] = []  # [{ user, socket_id, joined_at }]
        self.rooms: Dict[str, DebateRoom] = {}
        self.user_to_room: Dict[str, str] = {}  # user_id -> room_id
        self.socket_to_user: Dict[str, str] = {} # socket_id -> user_id
        self.user_to_socket: Dict[str, str] = {} # user_id -> socket_id

    def register_socket(self, socket_id: str, user_id: str):
        self.socket_to_user[socket_id] = user_id
        self.user_to_socket[user_id] = socket_id

    def unregister_socket(self, socket_id: str):
        user_id = self.socket_to_user.pop(socket_id, None)
        if user_id:
            self.user_to_socket.pop(user_id, None)
            self.leave_queue(user_id)

    def leave_queue(self, user_id: str):
        self.queue = [item for item in self.queue if item["user"]["id"] != user_id]

    async def join_queue(self, user: Dict[str, Any], socket_id: str):
        user_id = user["id"]
        self.register_socket(socket_id, user_id)

        # Remove existing if already in queue
        self.leave_queue(user_id)

        # Check if another human player is waiting
        if len(self.queue) > 0:
            opponent_item = self.queue.pop(0)
            opponent = opponent_item["user"]

            # Create Room
            room_id = f"room-{uuid.uuid4().hex[:8]}"

            # Randomize who is Player A vs Player B
            if random.random() > 0.5:
                p_a, p_b = user, opponent
            else:
                p_a, p_b = opponent, user

            room = DebateRoom(
                room_id=room_id,
                player_a=p_a,
                player_b=p_b,
                broadcast_fn=self.broadcast_fn,
                is_bot_match=False
            )

            self.rooms[room_id] = room
            self.user_to_room[p_a["id"]] = room_id
            self.user_to_room[p_b["id"]] = room_id

            # Start debate room state machine
            asyncio.create_task(room.start())
            return room
        else:
            # Place in queue
            self.queue.append({
                "user": user,
                "socket_id": socket_id,
                "joined_at": asyncio.get_event_loop().time()
            })
            await self.send_direct_fn(socket_id, {
                "type": "queue_joined",
                "queue_size": len(self.queue),
                "message": "Searching for an opponent in your skill tier..."
            })
            return None

    async def start_practice_match(self, user: Dict[str, Any], socket_id: str):
        """Creates an instant 1v1 match with an AI sparring partner for testing."""
        self.register_socket(socket_id, user["id"])
        self.leave_queue(user["id"])

        bot_names = [
            ("usr-bot-marcus", "Marcus (Debate Pro)", 1350, "#2c2c2e"),
            ("usr-bot-sophia", "Sophia (Oxford Finalist)", 1410, "#242426"),
            ("usr-bot-david", "David (Cambridge Union)", 1280, "#3a3a3c")
        ]
        b_id, b_name, b_rating, b_color = random.choice(bot_names)
        bot_player = {
            "id": b_id,
            "username": b_name.lower().replace(" ", "_"),
            "display_name": b_name,
            "rating": b_rating,
            "avatar_color": b_color,
            "is_bot": True
        }

        room_id = f"room-{uuid.uuid4().hex[:8]}"
        p_a, p_b = user, bot_player

        room = DebateRoom(
            room_id=room_id,
            player_a=p_a,
            player_b=p_b,
            broadcast_fn=self.broadcast_fn,
            is_bot_match=True
        )

        self.rooms[room_id] = room
        self.user_to_room[user["id"]] = room_id

        asyncio.create_task(room.start())
        return room

    def get_room_by_user(self, user_id: str) -> Optional[DebateRoom]:
        room_id = self.user_to_room.get(user_id)
        if room_id:
            return self.rooms.get(room_id)
        return None

    def get_room(self, room_id: str) -> Optional[DebateRoom]:
        return self.rooms.get(room_id)

    async def handle_disconnect(self, socket_id: str):
        user_id = self.socket_to_user.get(socket_id)
        self.unregister_socket(socket_id)
        if user_id:
            room_id = self.user_to_room.get(user_id)
            if room_id and room_id in self.rooms:
                room = self.rooms[room_id]
                opponent = room.get_opponent(user_id)
                if opponent:
                    opp_socket = self.user_to_socket.get(opponent["id"])
                    if opp_socket:
                        await self.send_direct_fn(opp_socket, {
                            "type": "opponent_disconnected",
                            "message": "Opponent temporarily lost connection."
                        })

