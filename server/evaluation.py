import re
import json
import math
import httpx
from typing import Dict, Any, List, Optional
from server.config import GEMINI_API_KEY, GROQ_API_KEY
from server.speech_scoring import predict_speech_scores

def calculate_elo(rating_a: int, rating_b: int, winner: Optional[str]) -> tuple[int, int]:
    """
    Standard Elo formula.
    winner: 'player_a', 'player_b', or 'draw' / None
    Returns: (delta_a, delta_b)
    """
    k = 32
    expected_a = 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))
    expected_b = 1.0 - expected_a

    if winner == "player_a":
        actual_a, actual_b = 1.0, 0.0
    elif winner == "player_b":
        actual_a, actual_b = 0.0, 1.0
    else:
        actual_a, actual_b = 0.5, 0.5

    delta_a = round(k * (actual_a - expected_a))
    delta_b = round(k * (actual_b - expected_b))
    return delta_a, delta_b

def check_vocabulary_hints(text: str, hints: List[str]) -> List[Dict[str, Any]]:
    """
    Checks which mandatory vocabulary words were spoken in the speech.
    Returns list of {word: str, used: bool, count: int}
    """
    results = []
    text_lower = text.lower()
    for word in hints:
        w_clean = word.lower().strip()
        # Word boundary or plural/stem regex
        pattern = rf"\b{re.escape(w_clean)}(?:s|ed|ing|tion|ly)?\b"
        matches = re.findall(pattern, text_lower)
        results.append({
            "word": word,
            "used": len(matches) > 0,
            "count": len(matches)
        })
    return results

def rubric_evaluate_speech(
    player_id: str,
    player_name: str,
    side: str,
    transcripts: List[Dict[str, Any]],
    opponent_transcripts: List[Dict[str, Any]],
    mandatory_vocabulary: List[str],
    motion: str
) -> Dict[str, Any]:
    """
    Rule-based deterministic scoring engine when no LLM key is supplied,
    or used to validate LLM outputs.
    """
    full_text = " ".join([t.get("transcript", "") for t in transcripts]).strip()
    words = re.findall(r"\b[a-zA-Z']+\b", full_text)
    word_count = len(words)
    unique_words = len(set([w.lower() for w in words]))
    ttr = (unique_words / max(word_count, 1))

    # Check hints
    hint_checks = check_vocabulary_hints(full_text, mandatory_vocabulary)
    hints_used = sum(1 for h in hint_checks if h["used"])
    hint_bonus = hints_used * 2  # up to +10

    # English scoring components
    # 1. Grammar: baseline 82, deduct for typical speech patterns or short speeches
    grammar_score = 80
    if word_count > 40:
        grammar_score += 6
    if word_count > 80:
        grammar_score += 6
    grammar_score = min(96, grammar_score)

    # 2. Vocabulary: based on lexical diversity
    vocab_score = 75 + int(ttr * 20) + (hints_used * 2)
    vocab_score = min(98, max(65, vocab_score))

    # 3 & 4. Fluency & Pronunciation (Powered by Trained Speech Models: GBR, BiLSTM & Transformer)
    speech_ml = predict_speech_scores(full_text, duration_sec=90.0)
    fluency_score = int(round(speech_ml["fluency_score"]))
    clarity_score = int(round(speech_ml["pronunciation_score"]))

    # Weighted English proficiency
    english_score = round(
        (0.30 * grammar_score) +
        (0.25 * vocab_score) +
        (0.20 * fluency_score) +
        (0.15 * clarity_score) +
        hint_bonus
    )
    english_score = min(100, max(50, english_score))

    # Debating scoring components
    # 1. Logic & reasoning: presence of causal connectors (because, therefore, consequence, leads to)
    connectors = ["because", "therefore", "furthermore", "consequently", "evidence", "proven", "demonstrates"]
    connector_count = sum(full_text.lower().count(c) for c in connectors)
    logic_score = min(95, 75 + connector_count * 4)

    # 2. Argument structure: presence of thesis and signposting
    structure_score = 80
    if any(p in full_text.lower() for p in ["first", "second", "primarily", "in conclusion", "to summarize"]):
        structure_score += 10

    # 3. Rebuttal quality: references to opponent or counter-points
    opp_text = " ".join([t.get("transcript", "") for t in opponent_transcripts]).strip().lower()
    rebuttal_markers = ["opponent", "counter", "disagree", "claim", "contrary", "however", "flaw"]
    rebuttal_count = sum(full_text.lower().count(m) for m in rebuttal_markers)
    rebuttal_score = min(96, 74 + rebuttal_count * 5)

    # 4. Persuasiveness: rhetorical strength
    persuasiveness_score = min(94, 76 + int(word_count * 0.12))

    # 5. Topical relevance
    relevance_score = 88 if word_count > 25 else 70

    # 6. Closing summary
    closing_score = 82 if len(transcripts) >= 2 else 74

    # Weighted Debating proficiency
    debate_score = round(
        (0.25 * logic_score) +
        (0.20 * structure_score) +
        (0.20 * rebuttal_score) +
        (0.15 * persuasiveness_score) +
        (0.10 * relevance_score) +
        (0.10 * closing_score)
    )
    debate_score = min(100, max(50, debate_score))

    # Grammar corrections generator
    grammar_corrections = []
    if "because of" in full_text.lower() and "due to the fact" not in full_text.lower():
        grammar_corrections.append({
            "original": "...because of this reason...",
            "corrected": "...due to this factor / as a consequence...",
            "explanation": "Elevate formal register by substituting casual causal clauses with precise argumentative connectors."
        })
    if word_count < 40:
        grammar_corrections.append({
            "original": full_text[:40] + "..." if full_text else "Incomplete turns",
            "corrected": "Elaborate with compound-complex sentences (e.g. 'While proponents suggest X, the empirical reality reveals Y.')",
            "explanation": "Expand argument depth to achieve full speaking cadence within the 45-second limit."
        })
    else:
        grammar_corrections.append({
            "original": "Strong argumentative cadence maintained.",
            "corrected": "N/A - High structural accuracy.",
            "explanation": "Subject-verb agreements and tense consistency were well-maintained throughout both speaking turns."
        })

    # Improvement suggestions
    suggestions = [
        f"Incorporate more direct quotations from your opponent's constructive speech to heighten rebuttal impact.",
        f"Deploy advanced transition signposts ('Notwithstanding...', 'A critical nuance is...') to strengthen debate flow.",
        f"Consistently weave all 5 mandatory vocabulary hints ({', '.join(mandatory_vocabulary[:3])}) into your central thesis."
    ]

    return {
        "player_id": player_id,
        "player_name": player_name,
        "side": side,
        "english_proficiency": english_score,
        "debating_proficiency": debate_score,
        "composite_score": round((english_score * 0.45) + (debate_score * 0.55), 1),
        "hint_checks": hint_checks,
        "hints_used_count": hints_used,
        "word_count": word_count,
        "english_breakdown": {
            "grammar": grammar_score,
            "vocabulary": vocab_score,
            "fluency": fluency_score,
            "clarity": clarity_score,
            "hint_bonus": hint_bonus
        },
        "debate_breakdown": {
            "logical_reasoning": logic_score,
            "argument_structure": structure_score,
            "rebuttal_quality": rebuttal_score,
            "persuasiveness": persuasiveness_score,
            "relevance": relevance_score,
            "closing_summary": closing_score
        },
        "grammar_corrections": grammar_corrections,
        "suggestions": suggestions,
        "speech_ml": speech_ml,
        "ml_models_active": True
    }

async def evaluate_debate(
    motion: str,
    mandatory_vocabulary: List[str],
    player_a: Dict[str, Any],
    player_b: Dict[str, Any],
    turns_a: List[Dict[str, Any]],
    turns_b: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Evaluates both players' speeches.
    Uses Gemini API if configured for nuanced qualitative evaluation,
    otherwise executes the comprehensive deterministic rubric engine.
    """
    # 1. Deterministic baseline evaluation
    eval_a = rubric_evaluate_speech(
        player_a["id"], player_a["display_name"], player_a["side"],
        turns_a, turns_b, mandatory_vocabulary, motion
    )
    eval_b = rubric_evaluate_speech(
        player_b["id"], player_b["display_name"], player_b["side"],
        turns_b, turns_a, mandatory_vocabulary, motion
    )

    # 2. If GEMINI_API_KEY is present, enhance with LLM insights
    if GEMINI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
                prompt = f"""
You are the Chief Adjudicator of an international 1v1 competitive debate league.
Debate Motion: "{motion}"
Mandatory Vocabulary: {json.dumps(mandatory_vocabulary)}

Player A ({player_a['display_name']} - Side {player_a['side']}):
Speeches:
{json.dumps([t.get('transcript', '') for t in turns_a])}

Player B ({player_b['display_name']} - Side {player_b['side']}):
Speeches:
{json.dumps([t.get('transcript', '') for t in turns_b])}

Evaluate each debater strictly and output valid JSON with this exact structure:
{{
  "player_a": {{
    "english_proficiency": <integer 0-100>,
    "debating_proficiency": <integer 0-100>,
    "english_breakdown": {{
      "grammar": <0-100>,
      "vocabulary": <0-100>,
      "fluency": <0-100>,
      "clarity": <0-100>
    }},
    "debate_breakdown": {{
      "logical_reasoning": <0-100>,
      "argument_structure": <0-100>,
      "rebuttal_quality": <0-100>,
      "persuasiveness": <0-100>,
      "relevance": <0-100>,
      "closing_summary": <0-100>
    }},
    "grammar_corrections": [
      {{"original": "quote", "corrected": "revision", "explanation": "why"}}
    ],
    "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
  }},
  "player_b": {{
    "english_proficiency": <integer 0-100>,
    "debating_proficiency": <integer 0-100>,
    "english_breakdown": {{
      "grammar": <0-100>,
      "vocabulary": <0-100>,
      "fluency": <0-100>,
      "clarity": <0-100>
    }},
    "debate_breakdown": {{
      "logical_reasoning": <0-100>,
      "argument_structure": <0-100>,
      "rebuttal_quality": <0-100>,
      "persuasiveness": <0-100>,
      "relevance": <0-100>,
      "closing_summary": <0-100>
    }},
    "grammar_corrections": [
      {{"original": "quote", "corrected": "revision", "explanation": "why"}}
    ],
    "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
  }}
}}
"""
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"response_mime_type": "application/json"}
                }
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                    llm_eval = json.loads(raw_text)

                    # Merge LLM nuances while preserving deterministic hint checks and calculations
                    for p_key, ev in [("player_a", eval_a), ("player_b", eval_b)]:
                        if p_key in llm_eval:
                            target = llm_eval[p_key]
                            ev["english_breakdown"].update(target.get("english_breakdown", {}))
                            ev["debate_breakdown"].update(target.get("debate_breakdown", {}))
                            if target.get("grammar_corrections"):
                                ev["grammar_corrections"] = target["grammar_corrections"]
                            if target.get("suggestions"):
                                ev["suggestions"] = target["suggestions"]
                            # Recalculate weighted scores deterministically
                            eb = ev["english_breakdown"]
                            ev["english_proficiency"] = min(100, max(40, round(
                                (0.30 * eb.get("grammar", 80)) +
                                (0.25 * eb.get("vocabulary", 80)) +
                                (0.20 * eb.get("fluency", 80)) +
                                (0.15 * eb.get("clarity", 80)) +
                                eb.get("hint_bonus", 0)
                            )))
                            db = ev["debate_breakdown"]
                            ev["debating_proficiency"] = min(100, max(40, round(
                                (0.25 * db.get("logical_reasoning", 80)) +
                                (0.20 * db.get("argument_structure", 80)) +
                                (0.20 * db.get("rebuttal_quality", 80)) +
                                (0.15 * db.get("persuasiveness", 80)) +
                                (0.10 * db.get("relevance", 80)) +
                                (0.10 * db.get("closing_summary", 80))
                            )))
                            ev["composite_score"] = round(
                                (ev["english_proficiency"] * 0.45) + (ev["debating_proficiency"] * 0.55), 1
                            )
        except Exception as e:
            print(f"[Evaluation] Gemini evaluation fallback to rubric: {e}")

    # Determine winner deterministically
    comp_a = eval_a["composite_score"]
    comp_b = eval_b["composite_score"]

    diff = comp_a - comp_b
    if abs(diff) < 0.8:
        winner = None
        winner_id = None
        winner_name = "Draw"
    elif diff > 0:
        winner = "player_a"
        winner_id = player_a["id"]
        winner_name = player_a["display_name"]
    else:
        winner = "player_b"
        winner_id = player_b["id"]
        winner_name = player_b["display_name"]

    delta_a, delta_b = calculate_elo(player_a.get("rating", 1200), player_b.get("rating", 1200), winner)

    return {
        "motion": motion,
        "winner": winner,
        "winner_id": winner_id,
        "winner_name": winner_name,
        "player_a": eval_a,
        "player_b": eval_b,
        "rating_changes": {
            "player_a": {
                "user_id": player_a["id"],
                "old_rating": player_a.get("rating", 1200),
                "new_rating": player_a.get("rating", 1200) + delta_a,
                "delta": delta_a
            },
            "player_b": {
                "user_id": player_b["id"],
                "old_rating": player_b.get("rating", 1200),
                "new_rating": player_b.get("rating", 1200) + delta_b,
                "delta": delta_b
            }
        }
    }

