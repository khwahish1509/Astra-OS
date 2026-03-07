"""
Agent Tools — General Purpose
================================
A flexible set of ADK FunctionTools available to ANY agent persona.
Gemini decides at runtime which tools are relevant based on context.

Tools:
  web_search          — search Google for real-time information
  evaluate_response   — score and give feedback on what the user said
  give_live_coaching  — deliver a specific coaching tip (uses vision context)
  remember_context    — persist a key fact about the user across the session
  get_structured_plan — generate a structured plan / agenda for the session
"""

from google.adk.tools.function_tool import FunctionTool


# ──────────────────────────────────────────────────────────────────
# Tool Functions
# ──────────────────────────────────────────────────────────────────

def web_search(query: str, context: str = "") -> dict:
    """
    Search the web for real-time information relevant to the conversation.
    Use this when you need current facts, company info, topic details,
    or anything that may have changed recently.

    Args:
        query: The search query.
        context: Why you're searching — helps ground the result.

    Returns:
        Search instruction for Gemini to execute via grounding.
    """
    return {
        "query": query,
        "context": context,
        "instruction": (
            "Use Google Search grounding to answer this query. "
            "Return concise, factual results directly relevant to the conversation."
        ),
    }


def evaluate_response(
    user_input: str,
    evaluation_goal: str,
    criteria: str = "clarity, relevance, depth",
) -> dict:
    """
    Evaluate what the user just said against a defined goal or standard.
    Use this when you need to score, grade, or assess the user's response.
    Works for interviews, language learning, tutoring, quizzes, etc.

    Args:
        user_input: What the user said (transcribed).
        evaluation_goal: What a good response should achieve.
        criteria: Comma-separated evaluation criteria.

    Returns:
        Evaluation schema for Gemini to fill in.
    """
    return {
        "user_input": user_input,
        "evaluation_goal": evaluation_goal,
        "criteria": criteria,
        "instruction": (
            "Score 1-10. Identify 1-2 specific strengths and 1 concrete improvement tip. "
            "Keep feedback actionable, brief, and encouraging. "
            "Deliver it naturally in speech — no bullet points."
        ),
    }


def give_live_coaching(
    observation: str,
    aspect: str = "general",
    tone: str = "encouraging",
) -> dict:
    """
    Deliver a real-time coaching tip based on something you observe.
    Use this when you notice something worth addressing — from camera
    vision, from what the user said, or from their emotional state.

    Args:
        observation: What you specifically observed.
        aspect: What aspect to address — e.g. 'posture', 'vocabulary',
                'confidence', 'pacing', 'accuracy', 'eye contact'.
        tone: 'encouraging', 'direct', or 'celebratory'.

    Returns:
        Coaching delivery instruction.
    """
    return {
        "observation": observation,
        "aspect": aspect,
        "tone": tone,
        "instruction": (
            "Weave this coaching tip naturally into conversation. "
            "Do not say 'I notice...' robotically — instead, e.g. "
            "'Try to keep your shoulders back — it projects confidence.' "
            "If tone is celebratory: genuinely affirm. "
            "If direct: be clear and brief without being harsh."
        ),
    }


def remember_context(key: str, value: str) -> dict:
    """
    Remember a key fact about the user to personalise the session.
    Use this for things like: user's name, their goal, a fact they shared,
    a mistake they keep repeating, or a strength to build on.

    Args:
        key: A label for what you're remembering (e.g. 'user_goal', 'weakness').
        value: The value to remember.

    Returns:
        Memory record (stored in session context).
    """
    return {
        "key": key,
        "value": value,
        "instruction": (
            "Acknowledge this naturally if relevant, then use it to personalise "
            "future responses. Don't over-reference it — just let it inform tone and content."
        ),
    }


def get_structured_plan(
    goal: str,
    duration_minutes: int = 30,
    user_level: str = "intermediate",
) -> dict:
    """
    Generate a structured agenda or plan for the current session.
    Use this at the start of a tutoring, coaching, or training session
    to set expectations and organise the flow.

    Args:
        goal: The main objective of the session.
        duration_minutes: How long the session will last.
        user_level: 'beginner', 'intermediate', or 'advanced'.

    Returns:
        Session plan schema for Gemini to populate.
    """
    return {
        "goal": goal,
        "duration_minutes": duration_minutes,
        "user_level": user_level,
        "instruction": (
            "Create a natural, conversational session plan. "
            "Describe it verbally as you'd explain it to someone on a video call — "
            "not as a bullet list. Keep it to 2-3 sentences max."
        ),
    }


# ──────────────────────────────────────────────────────────────────
# ADK FunctionTool wrappers
# ──────────────────────────────────────────────────────────────────

web_search_tool      = FunctionTool(func=web_search)
evaluate_tool        = FunctionTool(func=evaluate_response)
coaching_tool        = FunctionTool(func=give_live_coaching)
remember_tool        = FunctionTool(func=remember_context)
plan_tool            = FunctionTool(func=get_structured_plan)

ALL_TOOLS = [web_search_tool, evaluate_tool, coaching_tool, remember_tool, plan_tool]


# ──────────────────────────────────────────────────────────────────
# Gemini Live API function declarations
# ──────────────────────────────────────────────────────────────────

LIVE_TOOL_DECLARATIONS = [
    {
        "name": "web_search",
        "description": web_search.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query":   {"type": "STRING"},
                "context": {"type": "STRING"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "evaluate_response",
        "description": evaluate_response.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "user_input":       {"type": "STRING"},
                "evaluation_goal":  {"type": "STRING"},
                "criteria":         {"type": "STRING"},
            },
            "required": ["user_input", "evaluation_goal"],
        },
    },
    {
        "name": "give_live_coaching",
        "description": give_live_coaching.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "observation": {"type": "STRING"},
                "aspect":      {"type": "STRING"},
                "tone":        {"type": "STRING"},
            },
            "required": ["observation"],
        },
    },
    {
        "name": "remember_context",
        "description": remember_context.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "key":   {"type": "STRING"},
                "value": {"type": "STRING"},
            },
            "required": ["key", "value"],
        },
    },
    {
        "name": "get_structured_plan",
        "description": get_structured_plan.__doc__,
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "goal":             {"type": "STRING"},
                "duration_minutes": {"type": "INTEGER"},
                "user_level":       {"type": "STRING"},
            },
            "required": ["goal"],
        },
    },
]


# ──────────────────────────────────────────────────────────────────
# Tool dispatcher
# ──────────────────────────────────────────────────────────────────

_TOOL_MAP = {
    "web_search":          web_search,
    "evaluate_response":   evaluate_response,
    "give_live_coaching":  give_live_coaching,
    "remember_context":    remember_context,
    "get_structured_plan": get_structured_plan,
}


def dispatch_tool(name: str, args: dict) -> dict:
    fn = _TOOL_MAP.get(name)
    if not fn:
        return {"error": f"Unknown tool: {name}"}
    try:
        return fn(**args)
    except Exception as e:
        return {"error": str(e)}
