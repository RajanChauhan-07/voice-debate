import asyncio
import json
import uuid
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from server.config import BASE_DIR, PORT, HOST
from server.db import (
    init_db,
    get_or_create_user,
    get_leaderboard,
    get_user_matches
)
from server.matchmaking import MatchmakingManager
from server.topics import DEFAULT_TOPICS

app = FastAPI(title="VoiceDebate Arena API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections: connection_id -> WebSocket
active_sockets: Dict[str, WebSocket] = {}

async def broadcast_to_room(room_id: str, message: Dict[str, Any]):
    room = matchmaking.get_room(room_id)
    if not room:
        return

    payload_text = json.dumps(message)
    for p in [room.player_a, room.player_b]:
        if p and "id" in p:
            sock_id = matchmaking.user_to_socket.get(p["id"])
            if sock_id and sock_id in active_sockets:
                try:
                    await active_sockets[sock_id].send_text(payload_text)
                except Exception as e:
                    print(f"[WS] Broadcast error to {sock_id}: {e}")

async def send_direct_message(socket_id: str, message: Dict[str, Any]):
    if socket_id in active_sockets:
        try:
            await active_sockets[socket_id].send_text(json.dumps(message))
        except Exception as e:
            print(f"[WS] Direct send error to {socket_id}: {e}")

matchmaking = MatchmakingManager(
    broadcast_fn=broadcast_to_room,
    send_direct_fn=send_direct_message
)

# Initialize Database
@app.on_event("startup")
def on_startup():
    init_db()
    print("[DB] Initialized SQLite tables and leaderboard seeds.")

# REST API Models
class LoginRequest(BaseModel):
    username: str
    display_name: Optional[str] = None

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "active_connections": len(active_sockets),
        "queued_users": len(matchmaking.queue),
        "active_rooms": len(matchmaking.rooms)
    }

@app.post("/api/users/login")
def login_user(req: LoginRequest):
    if not req.username or len(req.username.strip()) == 0:
        raise HTTPException(status_code=400, detail="Username is required")
    user = get_or_create_user(req.username.strip().lower(), req.display_name)
    return user

@app.get("/api/leaderboard")
def fetch_leaderboard():
    return get_leaderboard(limit=20)

@app.get("/api/users/{user_id}/matches")
def fetch_user_matches(user_id: str):
    return get_user_matches(user_id, limit=10)

@app.get("/api/topics/sample")
def fetch_topics_sample():
    return DEFAULT_TOPICS

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    conn_id = f"conn-{uuid.uuid4().hex[:10]}"
    active_sockets[conn_id] = websocket

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
            except Exception:
                continue

            msg_type = data.get("type")
            user_info = data.get("user", {})

            if msg_type == "join_queue":
                await matchmaking.join_queue(user_info, conn_id)

            elif msg_type == "leave_queue":
                if user_info.get("id"):
                    matchmaking.leave_queue(user_info["id"])
                    await send_direct_message(conn_id, {"type": "queue_left"})

            elif msg_type == "start_practice":
                await matchmaking.start_practice_match(user_info, conn_id)

            elif msg_type == "live_transcript":
                user_id = data.get("user_id")
                text = data.get("text", "")
                is_final = data.get("is_final", False)
                room = matchmaking.get_room_by_user(user_id)
                if room:
                    await room.handle_transcript_update(user_id, text, is_final)

            elif msg_type == "dev_skip_turn":
                user_id = data.get("user_id")
                room = matchmaking.get_room_by_user(user_id)
                if room:
                    await room.skip_turn()

            elif msg_type == "dev_finish_debate":
                user_id = data.get("user_id")
                room = matchmaking.get_room_by_user(user_id)
                if room:
                    await room.trigger_evaluation()

            # WebRTC Signaling Relay
            elif msg_type in ["webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"]:
                user_id = data.get("user_id")
                room = matchmaking.get_room_by_user(user_id)
                if room:
                    opponent = room.get_opponent(user_id)
                    if opponent:
                        opp_socket_id = matchmaking.user_to_socket.get(opponent["id"])
                        if opp_socket_id:
                            await send_direct_message(opp_socket_id, {
                                "type": msg_type,
                                "sender_id": user_id,
                                "payload": data.get("payload")
                            })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error on connection {conn_id}: {e}")
    finally:
        active_sockets.pop(conn_id, None)
        await matchmaking.handle_disconnect(conn_id)

# Serve Frontend static assets
static_dir = BASE_DIR / "static"
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

@app.get("/")
def serve_root():
    index_path = static_dir / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "VoiceDebate Arena server is running. Frontend static assets loading..."}
