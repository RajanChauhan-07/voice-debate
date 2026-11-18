import json
import random
import httpx
from typing import Dict, Any, List
from server.config import GEMINI_API_KEY

DEFAULT_TOPICS: List[Dict[str, Any]] = [
    {
        "id": "topic-ai-teachers",
        "motion": "Should AI replace human teachers in secondary education?",
        "category": "Education & AI",
        "description": "Debate whether artificial intelligence tutors can provide superior personalized instruction compared to traditional educators.",
        "mandatory_vocabulary": [
            "Innovation",
            "Empathy",
            "Efficiency",
            "Critical thinking",
            "Accountability"
        ],
        "for_side_description": "Advocate for AI-driven education systems and scalable personalization.",
        "against_side_description": "Defend the indispensable human connection, mentorship, and emotional safety of human teachers."
    },
    {
        "id": "topic-social-media-minors",
        "motion": "Should algorithmic social media feeds be legally prohibited for minors under 16?",
        "category": "Technology & Society",
        "description": "Debate the regulation of recommendation algorithms and their psychological impact on teenagers.",
        "mandatory_vocabulary": [
            "Autonomy",
            "Addiction",
            "Regulation",
            "Well-being",
            "Censorship"
        ],
        "for_side_description": "Argue for state intervention to shield developing minds from addictive engagement loops.",
        "against_side_description": "Argue against government overreach, emphasizing parental responsibility and digital literacy."
    },
    {
        "id": "topic-remote-work",
        "motion": "Is fully remote work detrimental to company culture and collaborative innovation?",
        "category": "Workplace & Economy",
        "description": "Debate whether physical presence in offices is vital for creative breakthroughs and team cohesion.",
        "mandatory_vocabulary": [
            "Collaboration",
            "Productivity",
            "Spontaneity",
            "Isolation",
            "Flexibility"
        ],
        "for_side_description": "Argue that serendipity, trust-building, and workplace camaraderie erode without in-person contact.",
        "against_side_description": "Argue that asynchronous flexibility, global talent access, and deep focus outperform cubicles."
    },
    {
        "id": "topic-space-vs-climate",
        "motion": "Should governments divert space exploration budgets toward terrestrial climate mitigation?",
        "category": "Ethics & Science",
        "description": "Debate resource allocation between preserving planet Earth and discovering multi-planetary frontiers.",
        "mandatory_vocabulary": [
            "Sustainability",
            "Existential",
            "Allocation",
            "Exploration",
            "Urgency"
        ],
        "for_side_description": "Argue that immediate ecological survival on Earth must take precedence over distant rockets.",
        "against_side_description": "Argue that space technologies yield critical climate monitoring breakthroughs and ensure species resilience."
    },
    {
        "id": "topic-universal-basic-income",
        "motion": "Will a Universal Basic Income (UBI) prevent mass technological unemployment caused by automation?",
        "category": "Economy & Politics",
        "description": "Debate the economic viability and social impact of guaranteed unconditional government income.",
        "mandatory_vocabulary": [
            "Dignity",
            "Incentive",
            "Inflation",
            "Redistribution",
            "Automation"
        ],
        "for_side_description": "Argue that UBI provides a necessary safety net against AI labor displacement and empowers worker freedom.",
        "against_side_description": "Argue that UBI destroys work ethic, fuels inflation, and ignores targeted skills retraining."
    }
]

async def get_debate_topic() -> Dict[str, Any]:
    """
    Returns a debate topic. If GEMINI_API_KEY is configured, attempts to dynamically
    generate a fresh, provocative competitive motion with 5 vocabulary hints.
    Otherwise picks from the curated bank.
    """
    if GEMINI_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
                prompt = (
                    "Generate a provocative, balanced 1v1 debate motion for a fast-paced English debate competition.\n"
                    "Output strictly valid JSON matching this schema:\n"
                    "{\n"
                    '  "motion": "Should ... ?",\n'
                    '  "category": "Technology/Ethics/Society/Education",\n'
                    '  "description": "One sentence summary of the conflict",\n'
                    '  "mandatory_vocabulary": ["word1", "word2", "word3", "word4", "word5"],\n'
                    '  "for_side_description": "...",\n'
                    '  "against_side_description": "..."\n'
                    "}\n"
                    "The 5 mandatory vocabulary words must be advanced, relevant English terms suitable for an argumentative debate."
                )
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"response_mime_type": "application/json"}
                }
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
                    topic_data = json.loads(raw_text)
                    topic_data["id"] = f"dynamic-{random.randint(1000, 9999)}"
                    return topic_data
        except Exception as e:
            print(f"[Topics] Gemini dynamic generation fallback: {e}")

    # Curated topic fallback
    selected = random.choice(DEFAULT_TOPICS).copy()
    # Ensure fresh random copy
    return selected
