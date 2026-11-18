import sqlite3
import json
import uuid
from typing import Dict, Any, List, Optional
from server.config import DB_PATH

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        rating INTEGER DEFAULT 1200,
        matches_won INTEGER DEFAULT 0,
        matches_lost INTEGER DEFAULT 0,
        total_debates INTEGER DEFAULT 0,
        avg_english_score REAL DEFAULT 0.0,
        avg_debate_score REAL DEFAULT 0.0,
        avatar_color TEXT DEFAULT '#3B82F6',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        player_a_id TEXT NOT NULL,
        player_b_id TEXT NOT NULL,
        topic_json TEXT NOT NULL,
        winner_id TEXT,
        player_a_english_score INTEGER DEFAULT 0,
        player_a_debate_score INTEGER DEFAULT 0,
        player_b_english_score INTEGER DEFAULT 0,
        player_b_debate_score INTEGER DEFAULT 0,
        rating_delta_a INTEGER DEFAULT 0,
        rating_delta_b INTEGER DEFAULT 0,
        evaluation_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_a_id) REFERENCES users(id),
        FOREIGN KEY (player_b_id) REFERENCES users(id)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS match_turns (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        turn_name TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        speaker_side TEXT NOT NULL,
        transcript TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(id)
    );
    """)

    # Seed leaderboard if empty
    cursor.execute("SELECT COUNT(*) as count FROM users")
    count = cursor.fetchone()["count"]
    if count == 0:
        seed_users = [
            ("usr-sophia", "sophia_c", "Sophia Chen", 1485, 24, 3, 27, 93.5, 95.0, "#2c2c2e"),
            ("usr-marcus", "marcus_v", "Marcus Vance", 1420, 19, 5, 24, 89.2, 91.4, "#242426"),
            ("usr-elena", "elena_r", "Elena Rostova", 1365, 15, 6, 21, 91.0, 87.8, "#3a3a3c"),
            ("usr-david", "david_k", "David Kim", 1290, 11, 7, 18, 86.4, 85.0, "#1c1c1e"),
            ("usr-zara", "zara_m", "Zara Malik", 1245, 9, 8, 17, 84.1, 83.6, "#2c2c2e"),
        ]
        cursor.executemany("""
            INSERT INTO users (id, username, display_name, rating, matches_won, matches_lost, total_debates, avg_english_score, avg_debate_score, avatar_color)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, seed_users)

    # Normalize any existing colorful avatars to sleek dark monochrome
    cursor.execute("UPDATE users SET avatar_color = '#2c2c2e' WHERE avatar_color LIKE '#%' AND avatar_color NOT IN ('#2c2c2e', '#242426', '#3a3a3c', '#1c1c1e')")

    conn.commit()
    conn.close()

def get_or_create_user(username: str, display_name: Optional[str] = None) -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()

    if row:
        user = dict(row)
        conn.close()
        return user

    user_id = f"usr-{uuid.uuid4().hex[:8]}"
    d_name = display_name or username.capitalize()
    colors = ["#2c2c2e", "#242426", "#3a3a3c", "#1c1c1e"]
    import random
    avatar_color = random.choice(colors)

    cursor.execute("""
        INSERT INTO users (id, username, display_name, rating, avatar_color)
        VALUES (?, ?, ?, 1200, ?)
    """, (user_id, username, d_name, avatar_color))
    conn.commit()

    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    new_user = dict(cursor.fetchone())
    conn.close()
    return new_user

def update_user_rating(user_id: str, new_rating: int, won: bool, english_score: int, debate_score: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return

    won_inc = 1 if won else 0
    lost_inc = 0 if won else 1
    total = row["total_debates"] + 1

    # Running average
    prev_eng = row["avg_english_score"] or 0
    prev_deb = row["avg_debate_score"] or 0
    new_avg_eng = round((prev_eng * row["total_debates"] + english_score) / total, 1)
    new_avg_deb = round((prev_deb * row["total_debates"] + debate_score) / total, 1)

    cursor.execute("""
        UPDATE users
        SET rating = ?,
            matches_won = matches_won + ?,
            matches_lost = matches_lost + ?,
            total_debates = ?,
            avg_english_score = ?,
            avg_debate_score = ?
        WHERE id = ?
    """, (new_rating, won_inc, lost_inc, total, new_avg_eng, new_avg_deb, user_id))
    conn.commit()
    conn.close()

def save_match_result(
    match_id: str,
    room_id: str,
    player_a_id: str,
    player_b_id: str,
    topic: Dict[str, Any],
    winner_id: Optional[str],
    a_eng: int,
    a_deb: int,
    b_eng: int,
    b_deb: int,
    delta_a: int,
    delta_b: int,
    evaluation: Dict[str, Any],
    turns: List[Dict[str, Any]]
):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT OR REPLACE INTO matches (
            id, room_id, player_a_id, player_b_id, topic_json, winner_id,
            player_a_english_score, player_a_debate_score,
            player_b_english_score, player_b_debate_score,
            rating_delta_a, rating_delta_b, evaluation_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        match_id, room_id, player_a_id, player_b_id, json.dumps(topic), winner_id,
        a_eng, a_deb, b_eng, b_deb, delta_a, delta_b, json.dumps(evaluation)
    ))

    for turn in turns:
        t_id = f"turn-{uuid.uuid4().hex[:8]}"
        cursor.execute("""
            INSERT INTO match_turns (
                id, match_id, turn_index, turn_name, speaker_id, speaker_side, transcript
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            t_id, match_id, turn.get("turn_index", 0), turn.get("turn_name", ""),
            turn.get("speaker_id", ""), turn.get("speaker_side", ""), turn.get("transcript", "")
        ))

    conn.commit()
    conn.close()

def get_leaderboard(limit: int = 15) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, display_name, rating, matches_won, matches_lost, total_debates,
               avg_english_score, avg_debate_score, avatar_color
        FROM users
        ORDER BY rating DESC, matches_won DESC
        LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_user_matches(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.*, ua.display_name as player_a_name, ub.display_name as player_b_name
        FROM matches m
        JOIN users ua ON m.player_a_id = ua.id
        JOIN users ub ON m.player_b_id = ub.id
        WHERE m.player_a_id = ? OR m.player_b_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
    """, (user_id, user_id, limit))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

