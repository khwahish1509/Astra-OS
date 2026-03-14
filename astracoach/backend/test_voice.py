import asyncio
import os
from google import genai
from google.genai import types
import dotenv

async def test_voice():
    dotenv.load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    # We'll try with gemini-2.0-flash which definitely supports speech_config
    model_id = "gemini-2.5-flash-native-audio-latest"
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name="Puck"
                )
            )
        )
    )
    
    print(f"Connecting to {model_id} with voice 'Puck'...")
    try:
        async with client.aio.live.connect(model=model_id, config=config) as gemini:
            print("Successfully connected with voice config!")
            # Send a small text to hear it (if possible in headless test)
            # Actually, just connecting is enough to prove no 1008 error.
    except Exception as e:
        print(f"Connection failed: {type(e).__name__} - {e}")

if __name__ == "__main__":
    asyncio.run(test_voice())
