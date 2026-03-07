"""
Interview Tools (ADK FunctionTools)
=====================================
These tools are registered with the Gemini Live session as function
declarations. When Gemini decides to use one mid-conversation,
it emits a ToolCall event; our WebSocket handler executes the function
and returns a ToolResponse — all without breaking the audio stream.

ADK compliance: each function is wrapped as a google.adk FunctionTool
and also exported as a raw Gemini function declaration dict for the
Live API config.
"""

from google.adk.tools.function_tool import FunctionTool


# ─────────────────────────────────────────────────────────────────
# Tool functions (plain Python — ADK wraps these automatically)
# ─────────────────────────────────────────────────────────────────

def evaluate_candidate_answer(
    question: str,
    answer: str,
    job_role: str,
    difficulty: str = "medium",
) -> dict:
    """
    Evaluate the quality of the candidate's answer to an interview question.
    Use this after the candidate finishes answering to score their response.

    Args:
        question: The interview question that was asked.
        answer: The candidate's full answer (transcribed).
        job_role: The position being interviewed for.
        difficulty: 'easy', 'medium', or 'hard' — adjusts scoring expectations.

    Returns:
        A dict with score (1-10), strengths, weaknesses, and a tip.
    """
    # Gemini fills in the evaluation logic via its own reasoning —
    # this function declaration is the schema; Gemini populates the return.
    return {
        "question": question,
        "answer": answer,
        "job_role": job_role,
        "difficulty": difficulty,
        "eval_instruction": (
            "Score from 1-10. Check: STAR method usage, relevance to role, "
            "specificity of examples, communication clarity, and depth. "
            "Return: score (int), strengths (str), improvement_tip (str)."
        ),
    }


def get_next_question(
    job_role: str,
    difficulty: str,
    category: str,
    covered_topics: str = "",
) -> dict:
    """
    Select the next interview question to ask the candidate.
    Use this when transitioning between questions to keep variety.

    Args:
        job_role: The position (e.g., 'Software Engineer').
        difficulty: 'easy', 'medium', or 'hard'.
        category: One of: 'intro', 'behavioral', 'technical', 'situational',
                  'culture_fit', 'closing'.
        covered_topics: Comma-separated list of topics already discussed.

    Returns:
        The chosen question text and follow-up prompt.
    """
    return {
        "job_role": job_role,
        "difficulty": difficulty,
        "category": category,
        "covered_topics": covered_topics,
        "instruction": (
            "Generate a targeted, specific question for this role and category. "
            "Avoid topics already covered. For behavioral: request STAR format. "
            "For technical: be accurate to current industry standards."
        ),
    }


def give_body_language_coaching(
    observation: str,
    candidate_name: str = "the candidate",
) -> dict:
    """
    Provide real-time coaching on body language or presentation style
    based on what the AI sees through the camera.
    Call this when you notice something specific worth addressing.

    Args:
        observation: What you currently observe (e.g., 'candidate is looking down',
                     'candidate is fidgeting', 'candidate has great posture').
        candidate_name: The candidate's name for personalised feedback.

    Returns:
        Coaching message to deliver naturally in conversation.
    """
    return {
        "observation": observation,
        "candidate_name": candidate_name,
        "instruction": (
            "Deliver this as natural, encouraging coaching woven into conversation. "
            "If positive: affirm it. If negative: frame as a tip, not a criticism. "
            "Keep it brief (1-2 sentences)."
        ),
    }


def search_company_info(company_name: str, job_role: str) -> dict:
    """
    Research the company to ask more relevant and specific questions.
    Use this at the start of the interview to tailor your questions.

    Args:
        company_name: The company the candidate is applying to.
        job_role: The role they are interviewing for.

    Returns:
        Key facts about the company and role-specific context.
    """
    return {
        "company": company_name,
        "role": job_role,
        "instruction": (
            "Find: company mission, recent news, tech stack (if relevant), "
            "culture values, typical interview style. Use this to ask "
            "more relevant questions and show interviewer credibility."
        ),
    }


# ─────────────────────────────────────────────────────────────────
# ADK FunctionTool wrappers (for ADK compliance)
# ─────────────────────────────────────────────────────────────────

evaluate_tool   = FunctionTool(func=evaluate_candidate_answer)
question_tool   = FunctionTool(func=get_next_question)
coaching_tool   = FunctionTool(func=give_body_language_coaching)
search_tool     = FunctionTool(func=search_company_info)

ALL_TOOLS = [evaluate_tool, question_tool, coaching_tool, search_tool]


# ─────────────────────────────────────────────────────────────────
# Raw function declarations for Gemini Live API config
# (google.genai LiveConnectConfig uses these directly)
# ─────────────────────────────────────────────────────────────────

LIVE_TOOL_DECLARATIONS = [
    {
        "name": "evaluate_candidate_answer",
        "description": evaluate_candidate_answer.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question":   {"type": "STRING"},
                "answer":     {"type": "STRING"},
                "job_role":   {"type": "STRING"},
                "difficulty": {"type": "STRING"},
            },
            "required": ["question", "answer", "job_role"],
        },
    },
    {
        "name": "get_next_question",
        "description": get_next_question.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "job_role":        {"type": "STRING"},
                "difficulty":      {"type": "STRING"},
                "category":        {"type": "STRING"},
                "covered_topics":  {"type": "STRING"},
            },
            "required": ["job_role", "difficulty", "category"],
        },
    },
    {
        "name": "give_body_language_coaching",
        "description": give_body_language_coaching.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "observation":     {"type": "STRING"},
                "candidate_name":  {"type": "STRING"},
            },
            "required": ["observation"],
        },
    },
    {
        "name": "search_company_info",
        "description": search_company_info.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "company_name": {"type": "STRING"},
                "job_role":     {"type": "STRING"},
            },
            "required": ["company_name", "job_role"],
        },
    },
]


# ─────────────────────────────────────────────────────────────────
# Tool dispatcher — called when Gemini Live emits a ToolCall event
# ─────────────────────────────────────────────────────────────────

TOOL_MAP = {
    "evaluate_candidate_answer":  evaluate_candidate_answer,
    "get_next_question":          get_next_question,
    "give_body_language_coaching": give_body_language_coaching,
    "search_company_info":        search_company_info,
}


def dispatch_tool(name: str, args: dict) -> dict:
    """Execute a tool by name and return its result."""
    fn = TOOL_MAP.get(name)
    if not fn:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(**args)
    except Exception as e:
        return {"error": str(e)}
