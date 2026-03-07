import asyncio
import os
import sys

# Append the directory so it finds dotenv etc
sys.path.append(os.path.dirname(__file__))
import dotenv
dotenv.load_dotenv()

from google.genai import types
from google.adk import Runner
from google.adk.agents import LlmAgent, LiveRequestQueue, RunConfig
from google.adk.sessions import InMemorySessionService, Session

async def main():
    agent = LlmAgent(
        name="test_agent",
        model="gemini-2.5-flash-native-audio-latest",
        instruction="Say hello.",
        tools=[]
    )
    
    session_service = InMemorySessionService()
    session = await session_service.create_session(app_name="test_app", user_id="u1", session_id="s1")
    
    q = LiveRequestQueue()
    runner = Runner(
        app_name="test_app",
        agent=agent,
        session_service=session_service
    )
    
    print("Starting runner.run_live()...")
    async for event in runner.run_live(
        session=session,
        live_request_queue=q,
        run_config=RunConfig(response_modalities=["AUDIO"])
    ):
        print(f"Event: {type(event).__name__}")
        
    print("Runner finished.")

if __name__ == "__main__":
    asyncio.run(main())
