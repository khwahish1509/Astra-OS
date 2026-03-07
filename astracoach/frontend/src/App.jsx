import { useState } from 'react'
import SetupScreen from './SetupScreen'
import InterviewRoom from './InterviewRoom'

export default function App() {
  const [session, setSession] = useState(null)
  return session
    ? <InterviewRoom session={session} onEnd={() => setSession(null)} />
    : <SetupScreen onStart={setSession} />
}
