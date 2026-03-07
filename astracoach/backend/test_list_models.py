import os
from google import genai
import dotenv

dotenv.load_dotenv()
client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))

for m in client.models.list():
    if "bidiGenerateContent" in getattr(m, 'supported_actions', []) or "BIDI_GENERATE_CONTENT" in str(getattr(m, 'supported_actions', [])):
        print(f"Supported live model: {m.name}")
    elif hasattr(m, 'supported_generation_methods'):
        if 'bidiGenerateContent' in m.supported_generation_methods:
            print(f"Supported live model: {m.name}")
