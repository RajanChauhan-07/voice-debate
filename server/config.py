import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env if present
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Debate Timers (seconds)
TURN_DURATION_SECONDS = int(os.getenv("TURN_DURATION_SECONDS", 45))
COIN_TOSS_DURATION_SECONDS = int(os.getenv("COIN_TOSS_DURATION_SECONDS", 4))
TOPIC_REVEAL_DURATION_SECONDS = int(os.getenv("TOPIC_REVEAL_DURATION_SECONDS", 6))

DB_PATH = BASE_DIR / "data" / "debate.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
