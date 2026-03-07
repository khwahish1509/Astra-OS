import asyncio
import os
import json
from google import genai
from google.genai import types

async def main():
    import dotenv
    dotenv.load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(role="user", parts=[types.Part(text="Say hello. Keep it very short.")]),
    )
    print("Connecting...")
    async with client.aio.live.connect(model="gemini-2.5-flash-native-audio-latest", config=config) as gemini:
        print("Connected! Sending 'hello'")
        await gemini.send(input="hello", end_of_turn=True)
        async for response in gemini.receive():
            print(f"--- Response ---")
            if hasattr(response, "server_content") and response.server_content:
                sc = response.server_content
                if hasattr(sc, "model_turn"):
                    print("Has model_turn")
                if hasattr(sc, "turn_complete"):
                    print(f"turn_complete: {sc.turn_complete}")
                print(sc)
            else:
                print(response)
asyncio.run(main())
