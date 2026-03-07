import asyncio
import os
from google import genai
from google.genai import types

async def main():
    import dotenv
    dotenv.load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    print(f"Key set: {bool(api_key)}")
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
    )
    print("Connecting to live API...")
    try:
        async with client.aio.live.connect(model="gemini-2.0-flash-exp", config=config) as gemini:
            print("Connected successfully!")
    except Exception as e:
        print(f"Connection failed: {type(e).__name__} - {e}")

asyncio.run(main())
