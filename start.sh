#!/bin/bash
# Start VoiceDebate Arena
echo "🎙️ Starting VoiceDebate Arena on http://localhost:8000 ..."
python3 -m uvicorn server.app:app --host 0.0.0.0 --port 8000 --reload

