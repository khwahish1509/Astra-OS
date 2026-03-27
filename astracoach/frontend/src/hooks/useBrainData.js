/**
 * useBrainData.js — Data fetching hook for Astra OS Brain API
 * Handles polling, demo fallback, and state management.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DEMO_SUMMARY, DEMO_ALERTS, DEMO_RELATIONSHIPS, DEMO_INSIGHTS,
  DEMO_TASKS, DEMO_TEAMS, DEMO_ROUTED_EMAILS, DEMO_ROUTING_RULES,
  DEMO_MEMORY_FACTS, DEMO_MEMORY_EPISODES, DEMO_MEMORY_EVENTS, DEMO_MEMORY_STATUS,
} from '../data/demoData'

const POLL_INTERVAL = 30000
const FAST_POLL_INTERVAL = 8000

/**
 * Smart fallback: use real API data when available, demo data as fallback.
 * Unlike the old useDemoFallback which always returned demo data,
 * this actually checks if the API returned meaningful data.
 */
function smartFallback(apiData, demoData) {
  if (apiData === null || apiData === undefined) return demoData
  if (Array.isArray(apiData) && apiData.length === 0) return demoData
  return apiData
}

export function useBrainData(backendUrl, activeView) {
  const [summary, setSummary] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [relationships, setRelationships] = useState([])
  const [insights, setInsights] = useState([])
  const [tasks, setTasks] = useState([])
  const [teams, setTeams] = useState([])
  const [routedEmails, setRoutedEmails] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [memoryFacts, setMemoryFacts] = useState([])
  const [memoryEpisodes, setMemoryEpisodes] = useState([])
  const [memoryEvents, setMemoryEvents] = useState([])
  const [memoryStatus, setMemoryStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)

  // Email Intelligence state
  const [scoredEmails, setScoredEmails] = useState([])
  const [pipelineSummary, setPipelineSummary] = useState(null)
  const [scannerHealth, setScannerHealth] = useState(null)
  const [contactTiers, setContactTiers] = useState(null)
  const [emailBriefing, setEmailBriefing] = useState(null)
  const [newEmailCount, setNewEmailCount] = useState(0)

  const timerRef = useRef(null)
  const fastTimerRef = useRef(null)

  const fetchAll = useCallback(async () => {
    try {
      const [sumRes, alertRes, relRes, insightRes, taskRes, teamRes, emailRes, ruleRes, factRes, episodeRes, eventRes, statusRes, scoredRes, pipelineRes, healthRes, tierRes, briefingRes] = await Promise.all([
        fetch(`${backendUrl}/brain/summary`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/alerts?severity=medium`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/relationships`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/insights?limit=10`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/tasks/all`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/teams`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/emails/routed?limit=500`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/routing-rules`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/memory/facts`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/memory/episodes?limit=10`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/memory/events?limit=20`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/memory/status`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/emails/scored?limit=10000`).then(r => r.ok ? r.json() : {emails:[]}).catch(() => ({emails:[]})),
        fetch(`${backendUrl}/brain/emails/pipeline`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/emails/health`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/contacts/tiers`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/emails/briefing`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      setSummary(smartFallback(sumRes, DEMO_SUMMARY))
      setAlerts(smartFallback(alertRes, DEMO_ALERTS))
      setRelationships(smartFallback(relRes, DEMO_RELATIONSHIPS))
      setInsights(smartFallback(insightRes, DEMO_INSIGHTS))
      setTasks(smartFallback(taskRes, DEMO_TASKS))
      setTeams(smartFallback(teamRes, DEMO_TEAMS))
      setRoutedEmails(emailRes?.length ? emailRes : [])
      setRoutingRules(ruleRes?.length ? ruleRes : [])
      setMemoryFacts(smartFallback(factRes, DEMO_MEMORY_FACTS))
      setMemoryEpisodes(smartFallback(episodeRes, DEMO_MEMORY_EPISODES))
      setMemoryEvents(smartFallback(eventRes, DEMO_MEMORY_EVENTS))
      setMemoryStatus(smartFallback(statusRes, DEMO_MEMORY_STATUS))
      setScoredEmails(scoredRes?.emails || [])
      setPipelineSummary(pipelineRes)
      setScannerHealth(healthRes)
      setContactTiers(tierRes)
      setEmailBriefing(briefingRes)
    } catch {
      setSummary(DEMO_SUMMARY)
      setAlerts(DEMO_ALERTS)
      setRelationships(DEMO_RELATIONSHIPS)
      setInsights(DEMO_INSIGHTS)
      setTasks(DEMO_TASKS)
      setTeams(DEMO_TEAMS)
      setRoutedEmails(DEMO_ROUTED_EMAILS)
      setRoutingRules(DEMO_ROUTING_RULES)
      setMemoryFacts(DEMO_MEMORY_FACTS)
      setMemoryEpisodes(DEMO_MEMORY_EPISODES)
      setMemoryEvents(DEMO_MEMORY_EVENTS)
      setMemoryStatus(DEMO_MEMORY_STATUS)
      setScoredEmails([])
      setPipelineSummary(null)
      setScannerHealth(null)
      setContactTiers(null)
      setEmailBriefing(null)
    }
    setLoading(false)
  }, [backendUrl])

  const seedDemo = useCallback(async () => {
    setSeeding(true)
    try {
      await fetch(`${backendUrl}/brain/seed-demo`, { method: 'POST' })
      await fetchAll()
    } catch {}
    setSeeding(false)
  }, [backendUrl, fetchAll])

  // Main polling
  useEffect(() => {
    fetchAll()
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [fetchAll])

  // Fast polling for email view
  useEffect(() => {
    if (activeView !== 'email') {
      if (fastTimerRef.current) clearInterval(fastTimerRef.current)
      return
    }
    const fastPoll = async () => {
      try {
        const res = await fetch(`${backendUrl}/brain/emails/new-count`)
        if (res.ok) {
          const data = await res.json()
          setNewEmailCount(data.action_required || 0)
        }
      } catch {}
      try {
        const scoredRes = await fetch(`${backendUrl}/brain/emails/scored?limit=10000`)
        if (scoredRes.ok) {
          const d = await scoredRes.json()
          setScoredEmails(d?.emails || [])
        }
      } catch {}
    }
    fastTimerRef.current = setInterval(fastPoll, FAST_POLL_INTERVAL)
    return () => clearInterval(fastTimerRef.current)
  }, [activeView, backendUrl])

  return {
    summary, alerts, relationships, insights, tasks, teams,
    routedEmails, routingRules, memoryFacts, memoryEpisodes,
    memoryEvents, memoryStatus, loading, seeding,
    scoredEmails, setScoredEmails, pipelineSummary, scannerHealth,
    contactTiers, emailBriefing, newEmailCount,
    fetchAll, seedDemo,
  }
}
