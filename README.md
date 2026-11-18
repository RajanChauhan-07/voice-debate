# 🎙️ VoiceDebate Arena

> **Real-Time 1v1 Competitive Voice-Debating Platform**  
> Two debaters get matched, debate the same motion under time pressure, and receive rigorous independent scores for both their **English proficiency** and **debating abilities**.

---

## 🌟 The Product Concept

We are building a **competitive voice-debate game that happens to teach people English** — *not* an English-learning app with a debate feature.

- **Human vs Human from Day One**: Two users connect on the site, click **Start Match**, get paired via real-time Elo matchmaking, and enter the arena.
- **Server-Authoritative Microphone Control**: Only the active speaker's microphone is enabled; the opponent listens.
- **Live Peer-to-Peer Voice (WebRTC)**: Real-time audio streaming directly between participants.
- **Real-Time Speech-to-Text**: Live transcription streaming as participants speak.
- **5 Mandatory Vocabulary Hints**: Dynamic challenge words that debaters must weave into their arguments for bonus points.
- **Independent Dual Scoring**: Rigorous mathematical separation of English skills (grammar, vocabulary, fluency, clarity, bonus) and Debating skills (logic, structure, rebuttal clash, persuasiveness, relevance).

---

## 🧭 The 7-Step User Journey

```
STEP 01: Find an Opponent  ──► User clicks "START MATCH", enters Elo-ranked matchmaking queue.
           │
STEP 02: Match Found       ──► Two users connected in 1v1 room; WebRTC voice link established.
           │
STEP 03: Topic & 5 Hints   ──► Motion generated with FOR vs AGAINST sides and 5 mandatory vocabulary hints.
           │
STEP 04: Coin Toss         ──► 3D coin toss determines speaking order (e.g. Player A goes first).
           │
STEP 05: The Live Debate   ──► 3:00 Total · Four 45-second turns with server-controlled microphones.
           │                    Turn 01: Motion / Opening (Player A - 45s)
           │                    Turn 02: Constructive Speech (Player B - 45s)
           │                    Turn 03: Rebuttal (Player A - 45s)
           │                    Turn 04: Closing Summary (Player B - 45s)
           │
STEP 06: AI Evaluation     ──► Transcripts evaluated across 11 criteria using Gemini API / rubric.
           │
STEP 07: Results           ──► Winner banner, English & Debating proficiency scores, Elo update,
                               grammar corrections, 3 strategic coaching tips, and full transcripts.
```

---

## ⏱️ Official 3-Minute Debate Format

| Turn | Speaking Phase | Active Speaker | Side | Duration | Mic Permission |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **01** | **Motion / Opening** | Player A | FOR | 45 sec | **Player A Active** · B Listens |
| **02** | **Constructive Speech** | Player B | AGAINST | 45 sec | **Player B Active** · A Listens |
| **03** | **Rebuttal** | Player A | FOR | 45 sec | **Player A Active** · B Listens |
| **04** | **Closing Summary** | Player B | AGAINST | 45 sec | **Player B Active** · A Listens |
| **Total** | **4 Turns** | **Equal Time** | — | **3:00** | **Server-Enforced** |

---

## 📊 Dual Scoring Rubric

English proficiency and debating proficiency are computed independently using deterministic weighted formulas:

### 1. English Proficiency (0–100)
- **Grammar & Syntax** (30% weight)
- **Lexical Diversity & Sophistication** (25% weight)
- **Fluency & Speaking Pace** (20% weight)
- **Pronunciation & Diction Clarity** (15% weight)
- **Mandatory Vocabulary Bonus** (+2 points per mandatory hint used, up to +10 bonus points)

$$\text{English Score} = \min(100, 0.30 \cdot \text{Grammar} + 0.25 \cdot \text{Vocab} + 0.20 \cdot \text{Fluency} + 0.15 \cdot \text{Clarity} + \text{Bonus})$$

### 2. Debating Proficiency (0–100)
- **Logical Reasoning & Causal Connectors** (25% weight)
- **Argument Structure & Signposting** (20% weight)
- **Rebuttal Clash & Counter-claims** (20% weight)
- **Persuasiveness & Rhetorical Impact** (15% weight)
- **Topical Relevance** (10% weight)
- **Closing Synthesis** (10% weight)

$$\text{Debate Score} = \min(100, 0.25 \cdot \text{Logic} + 0.20 \cdot \text{Structure} + 0.20 \cdot \text{Rebuttal} + 0.15 \cdot \text{Persuasion} + 0.10 \cdot \text{Relevance} + 0.10 \cdot \text{Closing})$$

### 3. Elo Rating Update
Standard competitive Elo formula ($K = 32$):
$$E_A = \frac{1}{1 + 10^{(R_B - R_A)/400}}, \quad \Delta R_A = \text{round}(K \cdot (S_A - E_A))$$

---

## 🛠️ Architecture & Tech Stack

```
[ Frontend: React 18 + Tailwind + Web Audio Synthesizer + Canvas Waveform ]
      │                                                     │
      │ WebSockets (State Machine, Timers, Transcripts)      │ WebRTC (P2P Audio)
      ▼                                                     ▼
[ Backend: FastAPI (Python 3) + Uvicorn + SQLite DB ] ──► [ Peer-to-Peer Opponent ]
      │
      ├── Matchmaking Queue (Pairs users by Elo)
      ├── Authoritative Timer (Ticks 45s turns, transitions state)
      ├── Gemini API / Smart Rubric (AI debate adjudication & grammar fixes)
      └── SQLite DB (Users, Leaderboard, Match turns, ELO ratings)
```

- **Frontend**: React 18, Tailwind CSS, Web Audio API sound synthesizer (zero external audio assets needed), HTML5 Canvas audio visualizer, Web Speech API real-time STT.
- **WebRTC**: Peer-to-peer audio streaming with STUN servers (`stun.l.google.com:19302`).
- **Backend**: FastAPI with async WebSockets for state synchronization and WebRTC signaling.
- **Database**: SQLite database stored in `data/debate.db` with seeded global leaderboard.
- **AI Adjudicator**: Google Gemini API (`gemini-1.5-flash`) with fallback to built-in deterministic NLP rubric engine.

---

## 🚀 Quick Start

### 1. Launch the Server
```bash
./start.sh
```
Or directly:
```bash
python3 -m uvicorn server.app:app --host 0.0.0.0 --port 8000 --reload
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

---

## 👥 How to Test 1v1 Human vs Human Debates

1. Open **[http://localhost:8000](http://localhost:8000)** in Browser Window 1 (Player A: "Alex Chen").
2. Open **[http://localhost:8000?user=player2](http://localhost:8000?user=player2)** in Browser Window 2 (or in an Incognito window / side-by-side tab).
3. Click **START MATCH** on both windows.
4. **Instantly Matched!**
   - Both windows lock into the 1v1 room.
   - The debate topic and 5 mandatory vocabulary hints are revealed.
   - The 3D coin toss flips and announces who speaks first.
   - Live debate begins: 45s timer, microphone enabled for active speaker, real-time WebRTC audio, real-time transcript streaming, and hint words turning green!
5. **Testing Shortcuts Bar**:
   - Inside the arena, you can use the test bar at the bottom:
     - `+ Insert Spoken Argument`: Injects sample text with mandatory words for testing without talking.
     - `Fast-Forward Turn ⏩`: Skips to the next 45s turn immediately.
     - `Finish & AI Evaluate 📊`: Jumps straight to the AI evaluation and results screen!

---

## 🧪 Automated Test Suite

Run the full backend test suite to verify database, topics, hint detection, scoring formulas, and turn state machine:
```bash
python3 -m server.test_runner
```
Output:
```
==================================================
 RUNNING VOICEDEBATE ARENA VERIFICATION SUITE
==================================================
[1/5] Testing SQLite Database Initialization...
  ✓ User 1 created: Alex Chen (Rating: 1200)
  ✓ User 2 created: Jordan Blake (Rating: 1200)
  ✓ Leaderboard seeded with 5 debaters.
[2/5] Testing Debate Topics & Vocabulary Hints...
  ✓ Motion generated with 5 mandatory words
[3/5] Testing Spoken Vocabulary Hint Detection...
  ✓ 2 used hints detected accurately
[4/5] Testing Deterministic Scoring Rubric & Elo...
  ✓ English Score & Debate Score calculated independently
  ✓ Elo update verified (+16 / -16)
[5/5] Testing Debate Room State Machine & Turns...
  ✓ Turn 1 activated with server-authoritative microphone state
==================================================
 ✅ ALL TEST SUITES PASSED PERFECTLY!
==================================================
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port for the web server |
| `GEMINI_API_KEY` | *(optional)* | Google Gemini API key for dynamic topic generation & advanced adjudication |
| `TURN_DURATION_SECONDS` | `45` | Duration of each speaking turn |
| `COIN_TOSS_DURATION_SECONDS` | `4` | Duration of coin flip phase |
| `TOPIC_REVEAL_DURATION_SECONDS` | `6` | Duration of motion reveal phase |

*Note: VoiceDebate Arena is 100% functional out-of-the-box even without an external API key thanks to the built-in deterministic NLP debate rubric.*
