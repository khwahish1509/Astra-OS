import asyncio
import os
from google import genai
from google.genai import types

async def main():
    import dotenv
    dotenv.load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
    )
    print("Connecting...")
    try:
        async with client.aio.live.connect(model="gemini-2.5-flash-preview-native-audio-12-2025", config=config) as gemini:
            print("Connected to 2.5 flash native audio preview!")
    except Exception as e:
        print(f"Error: {type(e).__name__} - {e}")

asyncio.run(main())
