import { useState } from 'react'
import { ThemeProvider } from './ThemeContext'
import SetupScreen from './SetupScreen'
import InterviewRoom from './InterviewRoom'

export default function App() {
  const [session, setSession] = useState(null)
  return (
    <ThemeProvider>
      {session
        ? <InterviewRoom session={session} onEnd={() => setSession(null)} />
        : <SetupScreen onStart={setSession} />
      }
    </ThemeProvider>
  )
}
