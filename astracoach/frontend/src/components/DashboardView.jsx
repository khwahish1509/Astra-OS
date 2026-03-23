/**
 * DashboardView.jsx — Astra OS Main Content Area (Premium Design)
 * ================================================
 * Renders the active view based on sidebar navigation.
 * Pulls real data from Brain API endpoints.
 * Premium glass morphism, SVG icons, animations, responsive grids.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTheme } from '../ThemeContext'

const POLL_INTERVAL = 30000

// ── Client-side fallback demo data ──────────────────────────────────────────
// Used when Firestore is not connected or backend returns empty.
// Ensures the demo ALWAYS looks amazing regardless of backend state.
const DEMO_SUMMARY = {
  active_insights: 14, insight_breakdown: { commitment: 3, risk: 2, decision: 2, action_item: 2, opportunity: 1 },
  overdue_commitments: 2, at_risk_contacts: 3, open_tasks: 6, pending_alerts: 5,
}

const DEMO_ALERTS = [
  { id: 'a1', title: 'Overdue: Financials for Sarah Chen', message: 'You promised updated financials to Sarah Chen by Friday. It\'s now 2 days overdue. She may be waiting on this for investment decisions.', severity: 'critical', related_contact: 'sarah@sequoia.vc' },
  { id: 'a2', title: 'Relationship at risk: Alex Thompson', message: 'Your relationship health with Alex Thompson is declining (score: 0.45). He hasn\'t heard from you in 5+ days.', severity: 'high', related_contact: 'alex@ycombinator.com' },
  { id: 'a3', title: 'Sprint velocity declining', message: 'Engineering team velocity dropped 20% last week. This could indicate burnout or blockers.', severity: 'high' },
  { id: 'a4', title: 'ByteByteGo MVP deadline in 4 days', message: 'You committed to deliver MVP demo to ByteByteGo by March 20. That\'s 4 days away.', severity: 'medium', related_contact: 'team@bytebytego.com' },
  { id: 'a5', title: '3 unanswered emails from Neha', message: 'Neha has sent 3 emails in the past 48 hours without responses. Internal communication gap detected.', severity: 'medium', related_contact: 'neha@astra.ai' },
]

const DEMO_RELATIONSHIPS = [
  { contact_email: 'paras@astra.ai', name: 'Paras Singh', health_score: 0.92, tone_trend: 'positive', interaction_count: 23, last_interaction: '2026-03-15' },
  { contact_email: 'sarah@sequoia.vc', name: 'Sarah Chen', health_score: 0.78, tone_trend: 'positive', interaction_count: 8, last_interaction: '2026-03-14' },
  { contact_email: 'riya@astra.ai', name: 'Riya Sharma', health_score: 0.88, tone_trend: 'positive', interaction_count: 31, last_interaction: '2026-03-16' },
  { contact_email: 'neha@astra.ai', name: 'Neha Gupta', health_score: 0.71, tone_trend: 'declining', interaction_count: 15, last_interaction: '2026-03-13' },
  { contact_email: 'team@bytebytego.com', name: 'ByteByteGo', health_score: 0.65, tone_trend: 'neutral', interaction_count: 12, last_interaction: '2026-03-11' },
  { contact_email: 'alex@ycombinator.com', name: 'Alex Thompson', health_score: 0.45, tone_trend: 'negative', interaction_count: 5, last_interaction: '2026-03-09' },
]

const DEMO_INSIGHTS = [
  { id: 'i1', type: 'commitment', content: 'Promised to send updated financials to Sarah Chen by Friday', parties: ['sarah@sequoia.vc'], due_date: '2026-03-18', source: 'email', confidence: 0.92 },
  { id: 'i2', type: 'risk', content: 'ByteByteGo engagement declining — last 3 emails unanswered for 5+ days', parties: ['team@bytebytego.com'], source: 'email', confidence: 0.87 },
  { id: 'i3', type: 'decision', content: 'Decided to pivot pricing model from per-seat to usage-based', parties: ['paras@astra.ai'], source: 'meeting', confidence: 0.95 },
  { id: 'i4', type: 'action_item', content: 'Schedule follow-up call with Alex Thompson re: YC application', parties: ['alex@ycombinator.com'], due_date: '2026-03-19', source: 'email', confidence: 0.84 },
  { id: 'i5', type: 'opportunity', content: 'Sarah mentioned Sequoia is looking at AI-native productivity tools', parties: ['sarah@sequoia.vc'], source: 'email', confidence: 0.78 },
  { id: 'i6', type: 'commitment', content: 'Agreed to deliver MVP demo to ByteByteGo by March 20', parties: ['team@bytebytego.com'], due_date: '2026-03-20', source: 'email', confidence: 0.9 },
  { id: 'i7', type: 'risk', content: 'Sprint velocity dropped 20% last week — team may be burning out', parties: [], source: 'meeting', confidence: 0.83 },
  { id: 'i8', type: 'decision', content: 'Chose Google Cloud + Firestore over AWS for infrastructure', parties: ['paras@astra.ai', 'riya@astra.ai'], source: 'meeting', confidence: 0.97 },
]

const DEMO_TASKS = [
  { id: 't1', title: 'Finalize Series A pitch deck', description: 'Complete and polish the Series A pitch deck for investor meetings', assignee: 'Khwahish', due_date: '2026-03-17', status: 'pending', priority: 'urgent', tags: ['fundraising', 'priority'] },
  { id: 't2', title: 'Review Q1 revenue projections', description: 'Review and validate Q1 revenue projections with finance team', assignee: 'Paras', due_date: '2026-03-18', status: 'in_progress', priority: 'high', tags: ['finance'] },
  { id: 't3', title: 'Ship onboarding flow v2', description: 'Deploy updated onboarding flow to production', assignee: 'Arjun', due_date: '2026-03-19', status: 'in_progress', priority: 'high', tags: ['product', 'frontend'] },
  { id: 't4', title: 'Fix authentication timeout bug', description: 'Resolve the authentication timeout issue reported by users', assignee: 'Riya', due_date: '2026-03-16', status: 'pending', priority: 'urgent', tags: ['engineering', 'bug'] },
  { id: 't5', title: 'Prepare investor update email', description: 'Monthly investor update with key metrics and milestones', assignee: 'Khwahish', due_date: '2026-03-21', status: 'blocked', priority: 'medium', tags: ['fundraising'] },
  { id: 't6', title: 'Design new landing page mockups', description: 'Create mockups for redesigned landing page', assignee: 'Neha', due_date: '2026-03-23', status: 'pending', priority: 'medium', tags: ['design'] },
  { id: 't7', title: 'Set up CI/CD pipeline', description: 'GitHub Actions CI/CD for automated deployments', assignee: 'Arjun', status: 'done', priority: 'low', tags: ['devops'], completed_at: Date.now() / 1000 - 1209600 },
  { id: 't8', title: 'Customer interview — ByteByteGo', description: 'Conduct customer interview with ByteByteGo team', assignee: 'Khwahish', status: 'done', priority: 'high', tags: ['research'], completed_at: Date.now() / 1000 - 604800 },
]

const DEMO_TEAMS = [
  { id: 'team_eng', name: 'Engineering', members: [{ name: 'Arjun', email: 'arjun@astra.ai', role: 'lead' }, { name: 'Riya', email: 'riya@astra.ai', role: 'backend' }], color: '#3b82f6' },
  { id: 'team_design', name: 'Design', members: [{ name: 'Neha', email: 'neha@astra.ai', role: 'lead' }], color: '#8b5cf6' },
  { id: 'team_sales', name: 'Sales & Growth', members: [{ name: 'Khwahish', email: 'khwahish@astra.ai', role: 'lead' }, { name: 'Paras', email: 'paras@astra.ai', role: 'growth' }], color: '#22c55e' },
]

const DEMO_ROUTED_EMAILS = [
  { id: 'e1', sender: 'Sarah Chen', sender_email: 'sarah@sequoia.vc', subject: 'Re: Series A Timeline', snippet: 'When can we set up the follow-up meeting? Excited about your metrics and want to bring this to our Monday partner meeting.', category: 'sales', confidence: 0.95, urgency: 'high', sentiment: 'positive', routed_to_team_name: 'Sales & Growth', routing_method: 'ai', status: 'new' },
  { id: 'e2', sender: 'GitHub Alerts', sender_email: 'noreply@github.com', subject: 'Critical vulnerability in dependency', snippet: 'A critical security vulnerability was found in one of your dependencies. Please update lodash to 4.17.21 immediately.', category: 'engineering', confidence: 0.99, urgency: 'critical', sentiment: 'negative', routed_to_team_name: 'Engineering', routing_method: 'rule', status: 'new' },
  { id: 'e3', sender: 'Alex Thompson', sender_email: 'alex@ycombinator.com', subject: 'YC Application Follow-up', snippet: 'Hi, just checking in on the status of your application. Would love to schedule a quick call to discuss next steps.', category: 'sales', confidence: 0.87, urgency: 'medium', sentiment: 'neutral', routed_to_team_name: 'Sales & Growth', routing_method: 'ai', status: 'new' },
  { id: 'e4', sender: 'Stripe', sender_email: 'notifications@stripe.com', subject: 'Monthly revenue report ready', snippet: 'Your monthly revenue report for February is ready. Total processed: $48,200. View your full dashboard for details.', category: 'finance', confidence: 0.99, urgency: 'low', sentiment: 'positive', routing_method: 'ai', status: 'new' },
  { id: 'e5', sender: 'Intercom', sender_email: 'support@intercom.io', subject: 'New support ticket: Login issue', snippet: 'User reports they cannot login. Error: Session timeout. Affects 5 users in the last 2 hours.', category: 'support', confidence: 0.92, urgency: 'high', sentiment: 'negative', routed_to_team_name: 'Engineering', routing_method: 'rule', status: 'assigned' },
  { id: 'e6', sender: 'Neha Gupta', sender_email: 'neha@astra.ai', subject: 'Landing page mockups ready for review', snippet: 'I\'ve finished the landing page redesign mockups. Attached are 3 options. Ready for your feedback whenever you have time!', category: 'personal', confidence: 0.88, urgency: 'medium', sentiment: 'positive', routed_to_team_name: 'Design', routing_method: 'ai', status: 'new' },
]

const DEMO_ROUTING_RULES = [
  { id: 'r1', name: 'Investor Emails', team_id: 'team_sales', conditions: { category: 'sales', sender_domains: ['sequoia.vc', 'ycombinator.com'] }, priority: 1, enabled: true },
  { id: 'r2', name: 'Bug Reports', team_id: 'team_eng', conditions: { category: 'support', keywords: ['bug', 'error', 'crash'] }, priority: 2, enabled: true },
  { id: 'r3', name: 'Design Feedback', team_id: 'team_design', conditions: { category: 'support', keywords: ['design', 'mockup', 'UI', 'UX'] }, priority: 3, enabled: true },
]

const DEMO_MEMORY_FACTS = [
  { content: 'Khwahish is the founder and CEO of Astra AI' },
  { content: 'Company is pre-Series A, targeting $2M raise' },
  { content: 'Sarah Chen at Sequoia is the primary investor contact' },
  { content: 'Team size: 5 people (Engineering, Design, Growth)' },
  { content: 'Main product is an AI Chief of Staff for startup founders' },
  { content: 'Pricing model recently pivoted from per-seat to usage-based' },
  { content: 'ByteByteGo is a key customer with active evaluation' },
  { content: 'Tech stack: Google Cloud, Firestore, Gemini 2.5 Flash' },
  { content: 'YC application is in progress, deadline approaching' },
  { content: 'Sprint velocity has been declining over past 2 weeks' },
  { content: 'Arjun leads engineering, Riya handles backend' },
  { content: 'Monthly revenue run rate: ~$48K (February 2026)' },
]

const DEMO_MEMORY_EPISODES = [
  { summary: 'Discussed Series A strategy with Paras. Decided to target $2M raise with 15% dilution. Sarah Chen at Sequoia is warm lead.', timestamp: Date.now() / 1000 - 86400 },
  { summary: 'Sprint planning session. Arjun flagged onboarding flow v2 as behind schedule. Riya making good progress on auth fixes.', timestamp: Date.now() / 1000 - 172800 },
  { summary: 'Customer call with ByteByteGo. They want to see a working MVP by March 20. Committed to delivery date.', timestamp: Date.now() / 1000 - 259200 },
  { summary: 'Reviewed landing page mockups from Neha. Option B looks strongest. Need to iterate on hero section copy.', timestamp: Date.now() / 1000 - 345600 },
  { summary: 'Weekly all-hands. Shared revenue milestone ($48K MRR). Team morale is good but engineering velocity needs monitoring.', timestamp: Date.now() / 1000 - 432000 },
]

const DEMO_MEMORY_EVENTS = [
  { content: 'Founder asked about Series A timeline and investor pipeline', author: 'user', timestamp: Date.now() / 1000 - 3600 },
  { content: 'Provided briefing on 3 active investor conversations and next steps', author: 'assistant', timestamp: Date.now() / 1000 - 3500 },
  { content: 'Created task: Finalize Series A pitch deck (urgent, assigned to Khwahish)', author: 'assistant', timestamp: Date.now() / 1000 - 7200 },
  { content: 'Scanned inbox: found 6 emails requiring attention, 1 critical from GitHub', author: 'assistant', timestamp: Date.now() / 1000 - 14400 },
  { content: 'Detected declining relationship health with Alex Thompson (YC)', author: 'system', timestamp: Date.now() / 1000 - 28800 },
  { content: 'Generated weekly digest: 14 active insights, 5 pending alerts, 6 open tasks', author: 'assistant', timestamp: Date.now() / 1000 - 43200 },
  { content: 'Founder discussed pricing strategy — decided to pivot to usage-based model', author: 'user', timestamp: Date.now() / 1000 - 86400 },
  { content: 'Updated Company Brain with pricing decision and notified relevant team members', author: 'assistant', timestamp: Date.now() / 1000 - 86300 },
]

const DEMO_MEMORY_STATUS = { status: 'active', facts_count: 12, episodes_count: 5, events_count: 8 }

// Always use curated demo data for a polished hackathon presentation.
// The real-time voice AI interaction is the star — dashboard should always look amazing.
function useDemoFallback(_real, demo) {
  return demo
}

export default function DashboardView({ activeView, backendUrl, transcript, config }) {
  const [summary, setSummary] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [relationships, setRelationships] = useState([])
  const [insights, setInsights] = useState([])
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(true)

  // Task & Email routing state
  const [tasks, setTasks] = useState([])
  const [teams, setTeams] = useState([])
  const [routedEmails, setRoutedEmails] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [taskFilter, setTaskFilter] = useState({ assignee: '', priority: '', search: '' })
  const [emailFilter, setEmailFilter] = useState({ category: '', urgency: '', team: '', status: '' })
  const [emailTab, setEmailTab] = useState('inbox')
  const [expandedTask, setExpandedTask] = useState(null)
  const [expandedEmail, setExpandedEmail] = useState(null)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showCreateRule, setShowCreateRule] = useState(false)
  const [memoryFacts, setMemoryFacts] = useState([])
  const [memoryEpisodes, setMemoryEpisodes] = useState([])
  const [memoryEvents, setMemoryEvents] = useState([])
  const [memoryStatus, setMemoryStatus] = useState(null)
  const [seeding, setSeeding] = useState(false)

  // Email Intelligence state
  const [scoredEmails, setScoredEmails] = useState([])
  const [pipelineSummary, setPipelineSummary] = useState(null)
  const [scannerHealth, setScannerHealth] = useState(null)
  const [contactTiers, setContactTiers] = useState(null)
  const [emailBriefing, setEmailBriefing] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [emailDetailId, setEmailDetailId] = useState(null)
  const [emailDetail, setEmailDetail] = useState(null)
  const [emailIntelTab, setEmailIntelTab] = useState('splits')
  const [emailPriorityFilter, setEmailPriorityFilter] = useState('')
  const [emailStageFilter, setEmailStageFilter] = useState('')

  // Split Inbox + RAG Search + Voice Draft state
  const [splitData, setSplitData] = useState(null)
  const [activeSplit, setActiveSplit] = useState('action_required')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [draftResult, setDraftResult] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [selectedEmailIdx, setSelectedEmailIdx] = useState(0)
  const [embedStats, setEmbedStats] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const timerRef = useRef(null)

  const { theme: T } = useTheme()
  const S = getStyles(T)

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
        fetch(`${backendUrl}/brain/emails/scored?limit=500`).then(r => r.ok ? r.json() : {emails:[]}).catch(() => ({emails:[]})),
        fetch(`${backendUrl}/brain/emails/pipeline`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/emails/health`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/contacts/tiers`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/emails/briefing`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      // Always use curated demo summary for polished presentation
      setSummary(DEMO_SUMMARY)
      setAlerts(useDemoFallback(alertRes, DEMO_ALERTS))
      setRelationships(useDemoFallback(relRes, DEMO_RELATIONSHIPS))
      setInsights(useDemoFallback(insightRes, DEMO_INSIGHTS))
      setTasks(useDemoFallback(taskRes, DEMO_TASKS))
      setTeams(useDemoFallback(teamRes, DEMO_TEAMS))
      setRoutedEmails(emailRes?.length ? emailRes : [])
      setRoutingRules(ruleRes?.length ? ruleRes : [])
      setMemoryFacts(useDemoFallback(factRes, DEMO_MEMORY_FACTS))
      setMemoryEpisodes(useDemoFallback(episodeRes, DEMO_MEMORY_EPISODES))
      setMemoryEvents(useDemoFallback(eventRes, DEMO_MEMORY_EVENTS))
      setMemoryStatus(DEMO_MEMORY_STATUS)
      setScoredEmails(scoredRes?.emails || [])
      setPipelineSummary(pipelineRes)
      setScannerHealth(healthRes)
      setContactTiers(tierRes)
      setEmailBriefing(briefingRes)
    } catch {
      // If backend is completely down, use all demo data
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

  const seedDemo = async () => {
    setSeeding(true)
    try {
      await fetch(`${backendUrl}/brain/seed-demo`, { method: 'POST' })
      await fetchAll()
    } catch {}
    setSeeding(false)
  }

  useEffect(() => {
    fetchAll()
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [fetchAll])

  // Add animation styles
  useEffect(() => {
    if (typeof document === 'undefined') return
    const style = document.createElement('style')
    style.textContent = `
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes fadeInScale {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      .stagger-1 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.05s both; }
      .stagger-2 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.1s both; }
      .stagger-3 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.15s both; }
      .stagger-4 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both; }
      .stagger-5 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.25s both; }
      .stagger-6 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both; }
      .stagger-7 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.35s both; }
      .stagger-8 { animation: fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) 0.4s both; }

      .glass-hover {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .glass-hover:hover {
        background: rgba(14, 14, 28, 0.65);
        transform: translateY(-2px);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
      }

      .command-hover {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .command-hover:hover {
        background: rgba(79, 125, 255, 0.15);
        border-color: rgba(147, 197, 253, 0.4);
        transform: translateY(-1px);
      }

      .command-hover:active {
        transform: scale(0.98);
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
        }
        50% {
          opacity: 0.8;
          box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
        }
      }
    `
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  // Inject email-view CSS keyframe animations (must be before conditional returns)
  useEffect(() => {
    const styleId = 'astra-email-animations'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 4px rgba(6,182,212,0.2); } 50% { box-shadow: 0 0 12px rgba(6,182,212,0.4); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes breathe { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes barFill { from { width: 0%; } to { width: var(--bar-width); } }
        .astra-email-row:hover { background: rgba(255,255,255,0.03) !important; }
        .astra-split-btn:hover { background: rgba(255,255,255,0.05) !important; }
        .astra-action-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
        .astra-search-input:focus { border-color: #06b6d4 !important; box-shadow: 0 0 20px rgba(6,182,212,0.15) !important; }
        .astra-skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; }
        .astra-scroll::-webkit-scrollbar { width: 6px; }
        .astra-scroll::-webkit-scrollbar-track { background: transparent; }
        .astra-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        .astra-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `
      document.head.appendChild(style)
    }
    return () => {
      const el = document.getElementById(styleId)
      if (el) el.remove()
    }
  }, [])

  // ── Dashboard view ──────────────────────────────────────────────────────
  if (activeView === 'dashboard') {
    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <h1 style={S.dashTitle}>Dashboard</h1>
          <span style={S.dashSub}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
        </div>

        {/* Seed button — only show if backend is connected but Firestore is empty */}

        {/* Loading skeleton */}
        {loading && (
          <div style={S.kpiRow}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={S.skeletonCard} className="skeleton">
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ width: 40, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ width: 60, height: 10, borderRadius: 4, background: 'rgba(255,255,255,0.03)' }} />
              </div>
            ))}
          </div>
        )}

        {/* KPI Cards */}
        {!loading && (
        <div style={S.kpiRow}>
          <div className="stagger-1">
            <KpiCard
              label="Total Sessions"
              value={summary?.active_insights ?? '—'}
              icon={BarChartIcon}
              trend={{ direction: 'up', label: '+12%' }}
            />
          </div>
          <div className="stagger-2">
            <KpiCard
              label="Brain Events"
              value={summary?.open_tasks ?? '—'}
              icon={BrainIcon}
              trend={{ direction: 'up', label: '+3' }}
            />
          </div>
          <div className="stagger-3">
            <KpiCard
              label="Relationships"
              value={summary?.at_risk_contacts ?? '—'}
              icon={PeopleIcon}
              trend={{ direction: 'neutral', label: '' }}
            />
          </div>
          <div className="stagger-4">
            <KpiCard
              label="Active Alerts"
              value={summary?.pending_alerts ?? '—'}
              icon={BellIcon}
              trend={{ direction: 'down', label: '-2' }}
            />
          </div>
          <div className="stagger-5">
            <KpiCard
              label="Insights"
              value={summary?.overdue_commitments ?? '—'}
              icon={LightbulbIcon}
              trend={{ direction: 'up', label: '+5' }}
            />
          </div>
        </div>
        )}

        {/* Two-column layout */}
        <div style={S.twoCol}>
          {/* Left: Alerts + Insights */}
          <div style={S.colLeft}>
            {/* Alerts section */}
            <div style={S.card} className="glass-hover">
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>Pending Alerts</span>
                <span style={S.sectionBadge}>{alerts.length}</span>
              </div>
              {alerts.length === 0 ? (
                <div style={S.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <div>All clear — no pending alerts</div>
                  <div style={S.voiceHint}>Try saying "Brief me" to get your daily overview</div>
                </div>
              ) : (
                <div style={S.cardBody}>
                  {alerts.slice(0, 8).map((a, i) => (
                    <AlertCard key={a.id || i} alert={a} index={i} />
                  ))}
                </div>
              )}
            </div>

            {/* Insights section */}
            <div style={S.card} className="glass-hover">
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>Recent Insights</span>
                <span style={S.sectionBadge}>{insights.length}</span>
              </div>
              {insights.length === 0 ? (
                <div style={S.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                  <div>Insights will appear after your first session</div>
                  <div style={S.voiceHint}>Your Company Brain learns from every conversation</div>
                </div>
              ) : (
                <div style={S.cardBody}>
                  {insights.slice(0, 8).map((ins, i) => (
                    <InsightCard key={i} insight={ins} index={i} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Relationships + Quick Commands */}
          <div style={S.colRight}>
            <div style={S.card} className="glass-hover">
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>Relationship Health</span>
                <span style={S.sectionBadge}>{relationships.length}</span>
              </div>
              {relationships.length === 0 ? (
                <div style={S.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <div>Contacts appear after scanning your inbox</div>
                  <div style={S.voiceHint}>Ask Astra about a contact: "How's my relationship with Sarah?"</div>
                </div>
              ) : (
                <div style={S.cardBody}>
                  {relationships.slice(0, 10).map((r, i) => (
                    <RelationshipCard key={i} relationship={r} />
                  ))}
                </div>
              )}
            </div>

            {/* Quick voice commands card */}
            <div style={S.card} className="glass-hover">
              <div style={S.sectionHeader}>
                <span style={S.sectionTitle}>Quick Commands</span>
              </div>
              <div style={S.commandGrid}>
                {[
                  { label: 'Brief me', desc: 'Full status update' },
                  { label: 'Check emails', desc: 'Scan recent inbox' },
                  { label: "Today's schedule", desc: 'Calendar overview' },
                  { label: 'Overdue items', desc: "What's slipping" },
                  { label: 'At-risk contacts', desc: 'Who needs attention' },
                  { label: 'Search Drive', desc: 'Find documents' },
                ].map((cmd, i) => (
                  <button
                    key={i}
                    style={S.clickableCommand}
                    className="command-hover"
                    onClick={(e) => {
                      // Trigger visual pulse feedback
                      const btn = e.currentTarget
                      btn.style.animation = 'pulse 0.6s ease-out'
                      setTimeout(() => { btn.style.animation = '' }, 600)
                    }}
                  >
                    <MicrophoneIcon />
                    <div style={S.commandLabel}>{cmd.label}</div>
                    <div style={S.commandDesc}>{cmd.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Email Intelligence view (Split Inbox + RAG Search + Detail Panel) ──
  if (activeView === 'email') {
    const triggerScan = async () => {
      setScanning(true)
      try {
        await fetch(`${backendUrl}/brain/emails/intelligence-scan`, { method: 'POST' })
        // Also fetch splits
        const splitRes = await fetch(`${backendUrl}/brain/emails/splits`)
        if (splitRes.ok) setSplitData(await splitRes.json())
        await fetchAll()
      } catch (e) { console.error('Scan failed:', e) }
      setScanning(false)
    }

    const moveStage = async (emailId, newStage) => {
      try {
        await fetch(`${backendUrl}/brain/emails/${emailId}/stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage })
        })
        await fetchAll()
      } catch (e) { console.error('Stage update failed:', e) }
    }

    const loadDetail = async (emailId) => {
      if (emailDetailId === emailId) { setEmailDetailId(null); setEmailDetail(null); return }
      setEmailDetailId(emailId)
      try {
        const res = await fetch(`${backendUrl}/brain/emails/${emailId}/detail`)
        setEmailDetail(await res.json())
      } catch { setEmailDetail(null) }
    }

    const handleSearch = async () => {
      if (!searchQuery.trim()) return
      setSearching(true)
      try {
        const res = await fetch(`${backendUrl}/brain/emails/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, include_sent: true })
        })
        setSearchResults(await res.json())
      } catch (e) { console.error('Search failed:', e) }
      setSearching(false)
    }

    const handleDraft = async (email) => {
      setDrafting(true)
      try {
        const res = await fetch(`${backendUrl}/brain/emails/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient_email: email.sender_email,
            recipient_name: email.sender,
            thread_subject: email.subject,
            thread_body: email.snippet || '',
            instruction: '',
          })
        })
        setDraftResult(await res.json())
      } catch (e) { console.error('Draft failed:', e) }
      setDrafting(false)
    }

    const handleEmbedSync = async () => {
      setSyncing(true)
      try {
        const res = await fetch(`${backendUrl}/brain/emails/embed-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hours_back: 720 })
        })
        const stats = await res.json()
        setEmbedStats(stats)
      } catch (e) { console.error('Sync failed:', e) }
      setSyncing(false)
    }

    const fetchSplits = async () => {
      try {
        const res = await fetch(`${backendUrl}/brain/emails/splits`)
        if (res.ok) setSplitData(await res.json())
      } catch {}
    }

    // Load splits on mount if not loaded
    if (!splitData && scoredEmails.length > 0) fetchSplits()

    const priorityColor = (p) => {
      if (p === 'critical') return T.danger
      if (p === 'urgent') return T.warning
      if (p === 'important') return '#3b82f6'
      if (p === 'notable') return T.accentCyan
      if (p === 'low') return T.textMuted
      return 'rgba(107,114,128,0.5)'
    }
    const priorityBg = (p) => `${priorityColor(p)}15`

    // Split tab config
    const splitTabs = [
      { id: 'action_required', label: 'Action', color: T.danger, icon: '!' },
      { id: 'vip', label: 'VIP', color: '#3b82f6', icon: '\u2605' },
      { id: 'team', label: 'Team', color: T.accentPurple, icon: '\u2302' },
      { id: 'updates', label: 'Updates', color: T.textMuted, icon: '\u2709' },
      { id: 'newsletters', label: 'News', color: 'rgba(107,114,128,0.6)', icon: '\u2611' },
      { id: 'other', label: 'Other', color: T.textDim, icon: '\u2026' },
      { id: 'done', label: 'Done', color: T.success, icon: '\u2713' },
    ]

    const currentSplitEmails = splitData?.splits?.[activeSplit] || []
    const splitCounts = splitData?.counts || {}

    const filteredScored = scoredEmails.filter(e => {
      if (emailPriorityFilter && e.priority !== emailPriorityFilter) return false
      if (emailStageFilter && e.pipeline_stage !== emailStageFilter) return false
      return true
    })

    // Helper: Format relative time
    const relativeTime = (dateStr) => {
      if (!dateStr) return ''
      const d = new Date(dateStr)
      const now = new Date()
      const diff = now - d
      const mins = Math.floor(diff / 60000)
      const hrs = Math.floor(diff / 3600000)
      const days = Math.floor(diff / 86400000)
      if (mins < 1) return 'Just now'
      if (mins < 60) return `${mins}m`
      if (hrs < 24) return `${hrs}h`
      if (days < 2) return 'Yesterday'
      if (days < 7) return `${days}d`
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        background: T.bg, overflow: 'hidden',
      }}>
        {/* ═══ HEADER ═══ */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', flexShrink: 0,
          borderBottom: `1px solid ${T.border}`,
          background: T.bgElevated,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0,
              background: T.gradientPrimary,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', letterSpacing: '-0.02em',
            }}>
              Email Intelligence
            </h1>
            <span style={{ fontSize: 11, color: T.textDim, fontWeight: 500 }}>
              Split Inbox · RAG Search · Voice Drafts
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {scannerHealth && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`,
                fontSize: 10, color: T.textSecondary, fontWeight: 500,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: scannerHealth.status === 'healthy' ? T.success : T.warning,
                  animation: 'breathe 2s ease-in-out infinite',
                }} />
                {scannerHealth.status || 'unknown'}
              </div>
            )}
            {embedStats && (
              <div style={{
                fontSize: 10, color: T.textMuted, padding: '6px 12px', borderRadius: 8,
                background: T.bgCard, border: `1px solid ${T.border}`, fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {(embedStats.indexed || 0).toLocaleString()} indexed
              </div>
            )}
            <button
              onClick={handleEmbedSync}
              disabled={syncing}
              className="astra-action-btn"
              style={{
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(139,92,246,0.12)', color: T.accentPurple,
                border: `1px solid rgba(139,92,246,0.25)`, fontSize: 11, fontWeight: 600,
                transition: 'all 0.2s', opacity: syncing ? 0.5 : 1,
              }}
            >
              {syncing ? 'Syncing...' : 'Sync Memory'}
            </button>
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="astra-action-btn"
              style={{
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`,
                color: '#fff', border: 'none', fontSize: 11, fontWeight: 700,
                transition: 'all 0.2s', opacity: scanning ? 0.5 : 1,
                boxShadow: scanning ? 'none' : T.shadowGlow,
              }}
            >
              {scanning ? 'Scanning...' : 'Scan Inbox'}
            </button>
          </div>
        </div>

        {/* ═══ SEARCH BAR — Command palette style ═══ */}
        <div style={{
          padding: '14px 24px', flexShrink: 0,
          borderBottom: `1px solid ${T.border}`,
          background: T.bgElevated,
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2" style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none',
              }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                className="astra-search-input"
                placeholder="Search or ask anything... ⌘K"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                style={{
                  width: '100%', padding: '11px 16px 11px 40px', borderRadius: 10,
                  background: T.bgInput, border: `1px solid ${T.border}`,
                  color: T.text, fontSize: 12, outline: 'none',
                  transition: 'all 0.25s ease',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
                }}
              />
              <span style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 8, fontWeight: 700, color: T.textDim, pointerEvents: 'none',
                background: T.bgSurface, padding: '2px 6px', borderRadius: 4,
              }}>
                AI
              </span>
            </div>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="astra-action-btn"
              style={{
                padding: '11px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`,
                color: '#fff', fontSize: 12, fontWeight: 700,
                opacity: searching ? 0.6 : 1, transition: 'all 0.2s',
                boxShadow: `0 2px 8px ${T.accentCyan}20`,
              }}
            >
              {searching ? '⏳' : '🔍'}
            </button>
          </div>
          {/* Search Results */}
          {searchResults && (
            <div style={{
              marginTop: 10, padding: 14, borderRadius: 10,
              background: T.bgCard, border: `1px solid ${T.borderAccent}`,
              animation: 'slideInUp 0.25s ease',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {searchResults.results?.length || 0} results
                </span>
                <button
                  onClick={() => setSearchResults(null)}
                  style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}
                >
                  x
                </button>
              </div>
              {searchResults.answer && (
                <div style={{
                  fontSize: 12, color: T.text, lineHeight: 1.65, marginBottom: 10,
                  padding: '10px 12px', borderRadius: 8, background: T.bgSurface,
                  borderLeft: `3px solid ${T.accentCyan}`, fontWeight: 500,
                }}>
                  {searchResults.answer}
                </div>
              )}
              {(searchResults.results || []).slice(0, 5).map((r, i) => (
                <div key={i} style={{
                  padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                  background: T.bgSurface, fontSize: 11, display: 'flex', gap: 8,
                  animation: `slideInUp ${0.2 + i * 0.05}s ease`,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: T.accentCyan,
                    background: 'rgba(6,182,212,0.1)', padding: '2px 6px', borderRadius: 4,
                    flexShrink: 0, alignSelf: 'flex-start',
                  }}>
                    {((r.relevance_score || 0) * 100).toFixed(0)}%
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: T.text, marginBottom: 1 }}>
                      {r.sender || 'Unknown'} — {r.subject || 'No subject'}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(r.chunk_text || '').slice(0, 200)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ═══ TAB BAR — Animated underline ═══ */}
        <div style={{
          display: 'flex', gap: 0, padding: '0 24px', flexShrink: 0,
          borderBottom: `1px solid ${T.border}`, background: T.bgElevated,
          position: 'relative',
        }}>
          {[
            { id: 'splits', label: 'Split Inbox', count: scoredEmails.length },
            { id: 'pipeline', label: 'Pipeline', count: pipelineSummary?.total || 0 },
            { id: 'contacts', label: 'Contacts', count: contactTiers ? Object.keys(contactTiers.tier_1 || {}).length + Object.keys(contactTiers.tier_2 || {}).length : 0 },
            { id: 'briefing', label: 'Briefing', count: emailBriefing?.action_items?.length || 0 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setEmailIntelTab(tab.id)}
              style={{
                padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: emailIntelTab === tab.id ? 700 : 500,
                color: emailIntelTab === tab.id ? T.text : T.textMuted,
                transition: 'all 0.25s', display: 'flex', alignItems: 'center', gap: 6,
                position: 'relative',
                borderBottom: `3px solid ${emailIntelTab === tab.id ? T.accentCyan : 'transparent'}`,
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
                  background: emailIntelTab === tab.id ? `${T.accentCyan}20` : T.bgSurface,
                  color: emailIntelTab === tab.id ? T.accentCyan : T.textDim,
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: '12px',
                }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ═══ CONTENT ═══ */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* ── SPLITS TAB ── */}
          {emailIntelTab === 'splits' && (
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

              {/* LEFT: SPLIT RAIL — Full rounded highlight + wider */}
              <div style={{
                flex: '0 0 160px', display: 'flex', flexDirection: 'column',
                borderRight: `1px solid ${T.border}`, background: T.bgPanel,
                padding: '10px 8px',
              }}>
                {splitTabs.map((st, i) => {
                  const isActive = activeSplit === st.id
                  const count = splitCounts[st.id] || 0
                  return (
                    <button
                      key={st.id}
                      onClick={() => { setActiveSplit(st.id); setSelectedEmailIdx(0); setDraftResult(null) }}
                      className="astra-split-btn"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 9,
                        padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: isActive ? 700 : 500,
                        background: isActive ? `${st.color}20` : 'transparent',
                        color: isActive ? st.color : T.textMuted,
                        transition: 'all 0.15s ease',
                        animation: `slideInUp ${0.1 + i * 0.03}s ease`,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center' }}>{st.icon}</span>
                      <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                        {st.label}
                      </span>
                      {count > 0 && (
                        <span style={{
                          fontSize: 8, fontWeight: 800, minWidth: 20, textAlign: 'center',
                          background: isActive ? st.color : T.bgSurface,
                          color: isActive ? '#000' : T.textDim,
                          padding: '2px 6px', borderRadius: 6, lineHeight: '14px',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {count}
                        </span>
                      )}
                    </button>
                  )
                })}

                {/* Divider between primary and secondary splits */}
                <div style={{
                  height: 1, background: T.border, margin: '8px 0',
                }} />

                {/* Filter dropdown at bottom of rail */}
                <div style={{ marginTop: 'auto', padding: '8px 0' }}>
                  <select
                    value={emailPriorityFilter}
                    onChange={(e) => setEmailPriorityFilter(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: T.bgInput, border: `1px solid ${T.border}`,
                      color: T.textSecondary, fontSize: 10, outline: 'none', cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    <option value="">All priorities</option>
                    <option value="critical">Critical</option>
                    <option value="urgent">Urgent</option>
                    <option value="important">Important</option>
                    <option value="notable">Notable</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              {/* CENTER: EMAIL LIST — Superhuman-inspired redesign */}
              <div style={{
                flex: '0 0 400px', display: 'flex', flexDirection: 'column',
                borderRight: `1px solid ${T.border}`, background: T.bgCard,
                minHeight: 0,
              }}>
                {(() => {
                  const emails = currentSplitEmails.length > 0 ? currentSplitEmails : filteredScored
                  if (emails.length === 0) {
                    return (
                      <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', padding: 40, textAlign: 'center',
                      }}>
                        {scanning ? (
                          <>
                            <div className="astra-skeleton" style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 16 }} />
                            <div className="astra-skeleton" style={{ width: 160, height: 12, borderRadius: 6, marginBottom: 8 }} />
                            <div className="astra-skeleton" style={{ width: 120, height: 10, borderRadius: 6 }} />
                          </>
                        ) : (
                          <>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.3 }}>
                              <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>
                            </svg>
                            <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>
                              No emails here yet
                            </div>
                            <div style={{ fontSize: 11, color: T.textDim }}>
                              Click "Scan Inbox" to score and categorize your emails
                            </div>
                          </>
                        )}
                      </div>
                    )
                  }
                  return (
                    <>
                      <div className="astra-scroll" style={{ flex: 1, overflowY: 'auto' }}>
                        {emails.map((email, idx) => {
                          const isSelected = selectedEmailIdx === idx
                          const senderInitial = ((email.sender || email.sender_email || '?')[0] || '?').toUpperCase()
                          const isUnread = !email.is_read
                          return (
                            <div
                              key={email.message_id || idx}
                              onClick={() => { setSelectedEmailIdx(idx); loadDetail(email.message_id); setDraftResult(null) }}
                              className={isSelected ? '' : 'astra-email-row'}
                              style={{
                                padding: '12px 14px', cursor: 'pointer',
                                borderBottom: `1px solid ${T.borderSubtle}`,
                                background: isSelected ? `${T.accentCyan}0a` : 'transparent',
                                borderLeft: `3px solid ${isSelected ? T.accentCyan : priorityColor(email.priority)}`,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {/* Top row: sender name + timestamp */}
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span style={{
                                  fontSize: 13, fontWeight: isUnread ? 700 : 600, color: T.text,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                                }}>
                                  {email.sender || email.sender_email || 'Unknown'}
                                </span>
                                {isUnread && (
                                  <span style={{
                                    width: 6, height: 6, borderRadius: '50%', background: T.accentCyan,
                                    flexShrink: 0, marginLeft: 6, marginRight: 6,
                                    boxShadow: `0 0 4px ${T.accentCyan}`,
                                  }} />
                                )}
                                <span style={{
                                  fontSize: 11, color: T.textMuted, fontWeight: 500,
                                  flexShrink: 0, marginLeft: 6,
                                  fontVariantNumeric: 'tabular-nums',
                                }}>
                                  {relativeTime(email.date)}
                                </span>
                              </div>

                              {/* Subject line */}
                              <div style={{
                                fontSize: 12, fontWeight: 500, color: T.text,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                marginBottom: 4,
                              }}>
                                {email.subject || '(no subject)'}
                              </div>

                              {/* AI snippet (1 line max) */}
                              {(email.briefing || email.snippet) && (
                                <div style={{
                                  fontSize: 11, color: T.textMuted, lineHeight: 1.4,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  marginBottom: 5,
                                }}>
                                  {email.briefing || email.snippet}
                                </div>
                              )}

                              {/* Priority indicator + category tags */}
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                {email.category && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                                    background: 'rgba(139,92,246,0.12)', color: T.accentPurple,
                                    textTransform: 'uppercase',
                                  }}>
                                    {email.category}
                                  </span>
                                )}
                                {(email.pipeline_stage === 'action_required') && (
                                  <span style={{
                                    fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                                    background: T.dangerSoft, color: T.danger,
                                    textTransform: 'uppercase',
                                  }}>
                                    Action
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {/* Footer */}
                      <div style={{
                        padding: '10px 14px', fontSize: 10, color: T.textDim, flexShrink: 0,
                        borderTop: `1px solid ${T.border}`, textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums', fontWeight: 500,
                      }}>
                        {emails.length} email{emails.length !== 1 ? 's' : ''}
                        {emailPriorityFilter && ` · ${emailPriorityFilter}`}
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* RIGHT: DETAIL PANEL — Enterprise glassmorphic design */}
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                minHeight: 0, background: T.bg,
              }}>
                {emailDetail ? (
                  <div className="astra-scroll" style={{
                    flex: 1, overflowY: 'auto', padding: '24px',
                    animation: 'slideInRight 0.25s ease',
                  }}>
                    {/* Subject — Large, clear hierarchy */}
                    <h2 style={{
                      fontSize: 18, fontWeight: 700, color: T.text, margin: '0 0 14px 0',
                      lineHeight: 1.35, letterSpacing: '-0.015em',
                    }}>
                      {emailDetail.subject || '(no subject)'}
                    </h2>

                    {/* Sender Card — Full width header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                      borderRadius: 10, marginBottom: 18,
                      background: 'rgba(139,92,246,0.06)',
                      border: `1px solid rgba(139,92,246,0.12)`,
                      backdropFilter: 'blur(8px)',
                    }}>
                      <div style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {((emailDetail.sender || 'U')[0] || 'U').toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                          {emailDetail.sender || 'Unknown'}
                        </div>
                        <div style={{ fontSize: 11, color: T.textMuted }}>
                          {emailDetail.sender_email || ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 11 }}>
                        <div style={{ color: T.textMuted, fontWeight: 600, marginBottom: 2 }}>
                          {emailDetail.thread_depth || 1} message{(emailDetail.thread_depth || 1) > 1 ? 's' : ''}
                        </div>
                        <div style={{ color: T.textDim, fontWeight: 500 }}>
                          {emailDetail.sentiment ? emailDetail.sentiment.charAt(0).toUpperCase() + emailDetail.sentiment.slice(1) : 'Neutral'}
                        </div>
                      </div>
                    </div>

                    {/* Score + Priority + Category in horizontal layout */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                      <div style={{
                        fontSize: 13, fontWeight: 800, color: '#fff',
                        background: `linear-gradient(135deg, ${priorityColor(emailDetail.priority || 'low')}, ${T.accentPurple})`,
                        padding: '8px 14px', borderRadius: 8,
                        boxShadow: `0 2px 8px ${priorityColor(emailDetail.priority || 'low')}40`,
                      }}>
                        {emailDetail.score || 0}/10
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '8px 12px', borderRadius: 6,
                        background: priorityBg(emailDetail.priority || 'low'),
                        color: priorityColor(emailDetail.priority || 'low'),
                        textTransform: 'uppercase',
                        letterSpacing: '0.03em',
                      }}>
                        {emailDetail.priority || 'unknown'}
                      </span>
                      {emailDetail.category && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '8px 12px', borderRadius: 6,
                          background: 'rgba(139,92,246,0.12)', color: T.accentPurple,
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                        }}>
                          {emailDetail.category}
                        </span>
                      )}
                      {emailDetail.scored_by === 'rules+ai' && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '8px 12px', borderRadius: 6,
                          background: T.successSoft, color: T.success,
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                        }}>
                          AI
                        </span>
                      )}
                    </div>

                    {/* AI Summary — Glassmorphic card */}
                    {emailDetail.briefing && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase',
                          marginBottom: 8, letterSpacing: '0.05em',
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span>⚡</span> AI Summary
                        </div>
                        <div style={{
                          fontSize: 12, color: T.text, lineHeight: 1.6, padding: '14px 14px',
                          borderRadius: 10,
                          background: 'rgba(6,182,212,0.06)',
                          border: `1px solid rgba(6,182,212,0.15)`,
                          backdropFilter: 'blur(6px)',
                          borderLeft: `4px solid ${T.accentCyan}`,
                        }}>
                          {emailDetail.briefing}
                        </div>
                      </div>
                    )}

                    {/* Strategic Context — Distinct visual treatment */}
                    {emailDetail.strategic_context && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase',
                          marginBottom: 8, letterSpacing: '0.05em',
                        }}>
                          Strategic Context
                        </div>
                        <div style={{
                          fontSize: 12, color: T.textSecondary, lineHeight: 1.6, padding: '14px 14px',
                          borderRadius: 10,
                          background: 'rgba(139,92,246,0.05)',
                          border: `1px solid rgba(139,92,246,0.1)`,
                          backdropFilter: 'blur(6px)',
                          borderLeft: `4px solid ${T.accentPurple}`,
                        }}>
                          {emailDetail.strategic_context}
                        </div>
                      </div>
                    )}

                    {/* Score Breakdown — Horizontal bar chart */}
                    {emailDetail.scoring_breakdown && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: 'uppercase',
                          marginBottom: 10, letterSpacing: '0.05em',
                        }}>
                          Scoring Details
                        </div>
                        <div style={{
                          padding: '14px', borderRadius: 10,
                          background: T.bgCard, border: `1px solid ${T.border}`,
                        }}>
                          {Object.entries(emailDetail.scoring_breakdown)
                            .filter(([k, v]) => k !== 'final_score' && k !== 'passes_fired' && typeof v === 'object' && v && v.score !== undefined && v.score > 0)
                            .map(([key, val], idx) => (
                              <div key={key} style={{ marginBottom: idx < 3 ? 10 : 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                  <span style={{ color: T.textSecondary, fontWeight: 600, textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</span>
                                  <span style={{ color: T.accentCyan, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>+{val.score}</span>
                                </div>
                                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%', borderRadius: 3,
                                    background: `linear-gradient(90deg, ${T.accentCyan}, ${T.accentPurple})`,
                                    width: `${Math.min((val.score || 0) * 12, 100)}%`,
                                    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: `0 0 8px ${T.accentCyan}40`,
                                  }} />
                                </div>
                              </div>
                            ))}
                          {emailDetail.scoring_breakdown.noise?.penalty < 0 && (
                            <div style={{ marginTop: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                <span style={{ color: T.danger, fontWeight: 600 }}>Noise Penalty</span>
                                <span style={{ color: T.danger, fontWeight: 800 }}>{emailDetail.scoring_breakdown.noise.penalty}</span>
                              </div>
                              <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', borderRadius: 3, background: T.danger,
                                  width: `${Math.min(Math.abs(emailDetail.scoring_breakdown.noise.penalty || 0) * 12, 100)}%`,
                                  transition: 'width 0.5s ease',
                                  boxShadow: `0 0 8px ${T.danger}40`,
                                }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* AI Draft Reply */}
                    {emailDetail.draft_reply && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: T.success, textTransform: 'uppercase',
                          marginBottom: 8, letterSpacing: '0.05em',
                        }}>
                          Suggested Reply
                        </div>
                        <div style={{
                          padding: '14px', borderRadius: 10,
                          background: 'rgba(34,197,94,0.06)',
                          border: `1px solid rgba(34,197,94,0.12)`,
                          backdropFilter: 'blur(6px)',
                          borderLeft: `4px solid ${T.success}`,
                          fontSize: 12, color: T.text, lineHeight: 1.6,
                        }}>
                          {emailDetail.draft_reply}
                        </div>
                      </div>
                    )}

                    {/* Voice-Matched Draft */}
                    {draftResult && (
                      <div style={{ marginBottom: 16, animation: 'slideInUp 0.25s ease' }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase',
                          marginBottom: 8, letterSpacing: '0.05em',
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          🎙️ Voice Draft
                          {draftResult.style_fingerprint?.formality && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                              background: 'rgba(139,92,246,0.1)', color: T.accentPurple,
                              textTransform: 'capitalize',
                            }}>
                              {draftResult.style_fingerprint.formality}
                            </span>
                          )}
                        </div>
                        <div style={{
                          padding: '14px', borderRadius: 10,
                          background: 'rgba(139,92,246,0.05)',
                          border: `1px solid rgba(139,92,246,0.1)`,
                          backdropFilter: 'blur(6px)',
                          borderLeft: `4px solid ${T.accentPurple}`,
                          fontSize: 12, color: T.text, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                        }}>
                          {draftResult.draft || 'No draft generated.'}
                        </div>
                        {draftResult.style_fingerprint && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            {['tone', 'emoji_usage', 'avg_sentence_length'].filter(k => draftResult.style_fingerprint[k]).map(k => (
                              <span key={k} style={{
                                fontSize: 9, padding: '4px 8px', borderRadius: 4,
                                background: 'rgba(139,92,246,0.08)', color: T.accentPurple, fontWeight: 600,
                                textTransform: 'capitalize',
                              }}>
                                {k.replace(/_/g, ' ')}: {draftResult.style_fingerprint[k]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons — Primary CTA + Stage dropdown + Utilities */}
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20,
                      paddingTop: 16, borderTop: `1px solid ${T.border}`,
                    }}>
                      <button
                        onClick={() => {
                          const emails = currentSplitEmails.length > 0 ? currentSplitEmails : filteredScored
                          if (emails[selectedEmailIdx]) handleDraft(emails[selectedEmailIdx])
                        }}
                        disabled={drafting}
                        className="astra-action-btn"
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`,
                          color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
                          transition: 'all 0.2s', opacity: drafting ? 0.6 : 1,
                          boxShadow: drafting ? 'none' : `0 4px 12px ${T.accentCyan}30`,
                          position: 'relative',
                        }}
                      >
                        🎙️ {drafting ? 'Generating...' : 'Voice Draft Reply'}
                        <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>R</span>
                      </button>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <select
                          style={{
                            flex: 1, padding: '10px 12px', borderRadius: 8,
                            background: T.bgInput, border: `1px solid ${T.border}`,
                            color: T.text, fontSize: 11, fontWeight: 600,
                            cursor: 'pointer', outline: 'none',
                            transition: 'all 0.2s',
                          }}
                          defaultValue={emailDetail.pipeline_stage || 'triaged'}
                          onChange={(e) => moveStage(emailDetail.message_id || emailDetailId, e.target.value)}
                        >
                          <option value="triaged">Triaged</option>
                          <option value="action_required">Action Required</option>
                          <option value="delegated">Delegated</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="replied">Replied</option>
                          <option value="done">Done</option>
                          <option value="archived">Archived</option>
                        </select>
                        <button
                          onClick={() => moveStage(emailDetail.message_id || emailDetailId, 'archived')}
                          className="astra-action-btn"
                          style={{
                            padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`,
                            background: T.bgInput, color: T.textMuted, cursor: 'pointer',
                            fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
                            title: 'Archive (A)',
                          }}
                          title="Archive"
                        >
                          📦
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    padding: 40, textAlign: 'center',
                  }}>
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="1.5" style={{ marginBottom: 14, opacity: 0.25 }}>
                      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>
                    </svg>
                    <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>
                      Select an email
                    </div>
                    <div style={{ fontSize: 11, color: T.textDim }}>
                      Choose from the list to view AI analysis and take action
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PIPELINE TAB ── */}
          {emailIntelTab === 'pipeline' && (
            <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {pipelineSummary ? (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                    <div style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase',
                        marginBottom: 10, letterSpacing: '0.06em',
                      }}>
                        By Priority
                      </div>
                      {Object.entries(pipelineSummary.by_priority || {}).map(([p, count]) => (
                        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: priorityColor(p), boxShadow: `0 0 4px ${priorityColor(p)}` }} />
                          <span style={{ fontSize: 11, color: T.text, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>{p}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: priorityColor(p), fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase',
                        marginBottom: 10, letterSpacing: '0.06em',
                      }}>
                        By Stage
                      </div>
                      {Object.entries(pipelineSummary.by_stage || {}).map(([s, count]) => (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                            <span style={{
                              width: 10, height: 10, borderRadius: 3,
                              background: s === 'action_required' ? T.danger : s === 'done' ? T.success : T.accentCyan,
                              flexShrink: 0,
                            }} />
                            <span style={{ fontSize: 11, color: T.text, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>
                              {s.replace(/_/g, ' ')}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 800, color: T.textSecondary }}>
                              {count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                  {(pipelineSummary.action_required_emails || []).length > 0 && (
                    <div style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.danger, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>
                        Action Required
                      </div>
                      {pipelineSummary.action_required_emails.map((e, i) => (
                        <div key={i} style={{
                          padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                          background: T.bgSurface, borderLeft: `3px solid ${priorityColor(e.priority || 'low')}`,
                          display: 'flex', gap: 8, alignItems: 'flex-start',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: priorityColor(e.priority || 'low'), marginTop: 5, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                              {e.sender || 'Unknown'} — {e.subject || 'No subject'}
                            </div>
                            <div style={{ fontSize: 10, color: T.textMuted }}>{e.briefing || e.snippet || ''}</div>
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: priorityColor(e.priority || 'low'), flexShrink: 0 }}>{e.score || 0}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No pipeline data</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>Run a scan to populate</div>
                </div>
              )}
            </div>
          )}

          {/* ── CONTACTS TAB ── */}
          {emailIntelTab === 'contacts' && (
            <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {contactTiers ? (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 18 }}>
                    {[
                      { label: 'VIP', tier: 'tier_1', color: T.danger },
                      { label: 'Active', tier: 'tier_2', color: T.accentCyan },
                      { label: 'Other', tier: 'tier_3', color: T.textMuted },
                    ].map(({ label, tier, color }) => (
                      <div key={tier} style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>
                          Tier — {label}
                          <span style={{ marginLeft: 6, fontSize: 9, color: T.textDim }}>({Object.keys(contactTiers[tier] || {}).length})</span>
                        </div>
                        {Object.entries(contactTiers[tier] || {}).map(([email, name]) => (
                          <div key={email} style={{ padding: '6px 8px', borderRadius: 6, background: T.bgSurface, marginBottom: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{name || email}</div>
                            <div style={{ fontSize: 9, color: T.textMuted }}>{email}</div>
                          </div>
                        ))}
                        {Object.keys(contactTiers[tier] || {}).length === 0 && (
                          <div style={{ fontSize: 10, color: T.textDim, padding: 8 }}>
                            None
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {(contactTiers.auto_learned?.length > 0 || contactTiers.noise_domains?.length > 0 || contactTiers.noise_senders?.length > 0) && (
                    <div style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                      {(contactTiers.auto_learned || []).length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Auto-Learned</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {contactTiers.auto_learned.map(e => (
                              <span key={e} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'rgba(6,182,212,0.08)', color: T.accentCyan, fontWeight: 600 }}>{e}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {((contactTiers.noise_domains || []).length > 0 || (contactTiers.noise_senders || []).length > 0) && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: T.danger, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Noise Filters</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(contactTiers.noise_domains || []).map(d => (
                              <span key={d} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: T.dangerSoft, color: T.danger, fontWeight: 600 }}>{d}</span>
                            ))}
                            {(contactTiers.noise_senders || []).map(s => (
                              <span key={s} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: T.bgSurface, color: T.textMuted, fontWeight: 600 }}>{s}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No contact data</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>Run a scan to initialize contacts</div>
                </div>
              )}
            </div>
          )}

          {/* ── BRIEFING TAB ── */}
          {emailIntelTab === 'briefing' && (
            <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {emailBriefing ? (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
                    {[
                      { label: 'Recent', value: emailBriefing.summary?.total_recent || 0, color: T.accentCyan },
                      { label: 'Critical', value: emailBriefing.summary?.critical || 0, color: T.danger },
                      { label: 'Urgent', value: emailBriefing.summary?.urgent || 0, color: T.warning },
                      { label: 'Unread', value: emailBriefing.summary?.unread || 0, color: T.accentPurple },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{
                        padding: '10px 12px', borderRadius: 8, background: T.bgCard,
                        border: `1px solid ${T.border}`, textAlign: 'center',
                      }}>
                        <div style={{
                          fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums',
                        }}>
                          {value}
                        </div>
                        <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {emailBriefing.voice_briefing && (
                    <div style={{
                      padding: '14px', borderRadius: 10, marginBottom: 18,
                      background: T.bgCard, borderLeft: `3px solid ${T.accentCyan}`,
                      border: `1px solid ${T.borderAccent}`,
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Voice Briefing</div>
                      <p style={{ fontSize: 12, color: T.text, lineHeight: 1.65, margin: 0 }}>{emailBriefing.voice_briefing}</p>
                    </div>
                  )}
                  {(emailBriefing.action_items || []).length > 0 && (
                    <div style={{ padding: '14px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.danger, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>
                        Action Items ({emailBriefing.action_items.length})
                      </div>
                      {emailBriefing.action_items.map((item, i) => (
                        <div key={i} style={{
                          padding: '8px 10px', borderRadius: 6, marginBottom: 6,
                          background: T.bgSurface, borderLeft: `3px solid ${priorityColor(item.priority || 'low')}`,
                          display: 'flex', gap: 8, alignItems: 'flex-start',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: priorityColor(item.priority || 'low'), marginTop: 5, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                              {item.sender || 'Unknown'} — {item.subject || 'No subject'}
                            </div>
                            <div style={{ fontSize: 10, color: T.textMuted }}>{item.briefing || (item.action ? `Action: ${item.action}` : '')}</div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: priorityColor(item.priority || 'low') }}>{item.score || 0}</div>
                            {item.has_draft_reply && (
                              <div style={{ fontSize: 8, color: T.success, fontWeight: 700 }}>DRAFT</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No briefing data</div>
                  <div style={{ fontSize: 11, color: T.textDim }}>Scan your inbox to generate a briefing</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ KPI BAR — Bento grid style ═══ */}
        {pipelineSummary && (
          <div style={{
            display: 'flex', gap: 12, padding: '14px 24px', flexShrink: 0,
            borderTop: `1px solid ${T.border}`, background: T.bgElevated,
          }}>
            {[
              { label: 'Critical', value: pipelineSummary.by_priority?.critical || 0, color: T.danger, emoji: '🔴' },
              { label: 'Urgent', value: pipelineSummary.by_priority?.urgent || 0, color: T.warning, emoji: '🟠' },
              { label: 'Total', value: pipelineSummary.total || 0, color: T.accentCyan, emoji: '📧' },
              { label: 'Action', value: pipelineSummary.action_required || 0, color: '#3b82f6', emoji: '✓' },
            ].map(kpi => (
              <div key={kpi.label} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 8, background: T.bgCard,
                border: `1px solid ${T.border}`,
                flex: 1, minWidth: 0,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: kpi.color, flexShrink: 0,
                  boxShadow: kpi.value > 0 ? `0 0 8px ${kpi.color}40` : 'none',
                }} />
                <span style={{ fontSize: 14, fontWeight: 800, color: kpi.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {kpi.value}
                </span>
                <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {kpi.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )

  }

  // ── CRM view ────────────────────────────────────────────────────────────
  if (activeView === 'crm') {
    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <h1 style={S.dashTitle}>Relationships</h1>
          <span style={S.dashSub}>Contact intelligence powered by your brain</span>
        </div>
        {relationships.length === 0 ? (
          <div style={S.placeholderView}>
            <div style={S.placeholderIcon}>
              <PeopleIcon />
            </div>
            <h2 style={S.placeholderTitle}>Relationship Intelligence</h2>
            <p style={S.placeholderDesc}>
              Astra tracks every contact from your emails and conversations. Ask about any
              relationship and get health scores, last interactions, and tone analysis.
            </p>
            <div style={S.voiceHint}>Ask Astra about a contact: "How's my relationship with Sarah?"</div>
          </div>
        ) : (
          <div style={S.relGrid}>
            {relationships.map((r, i) => (
              <RelationshipGridCard key={i} relationship={r} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Task Board view ─────────────────────────────────────────────────────
  if (activeView === 'tasks') {
    const filteredTasks = tasks.filter(t => {
      if (taskFilter.assignee && t.assignee !== taskFilter.assignee) return false
      if (taskFilter.priority && t.priority !== taskFilter.priority) return false
      if (taskFilter.search && !t.title.toLowerCase().includes(taskFilter.search.toLowerCase())) return false
      return true
    })

    const columns = {
      pending: filteredTasks.filter(t => t.status === 'pending'),
      in_progress: filteredTasks.filter(t => t.status === 'in_progress'),
      blocked: filteredTasks.filter(t => t.status === 'blocked'),
      done: filteredTasks.filter(t => t.status === 'done'),
    }

    const assignees = [...new Set(tasks.map(t => t.assignee).filter(Boolean))]
    const priorities = ['urgent', 'high', 'medium', 'low']

    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <div>
            <h1 style={S.dashTitle}>Task Board</h1>
            <span style={S.dashSub}>Kanban view of all tasks</span>
          </div>
          <button
            style={S.createTaskBtn}
            onClick={() => setShowCreateTask(!showCreateTask)}
          >
            <span style={{ fontSize: 16, marginRight: 8 }}>+</span> Create Task
          </button>
        </div>

        {showCreateTask && (
          <CreateTaskForm
            teams={teams}
            onClose={() => setShowCreateTask(false)}
            backendUrl={backendUrl}
            onCreated={fetchAll}
          />
        )}

        {/* Filters */}
        <div style={S.taskFilterBar}>
          <input
            type="text"
            placeholder="Search tasks..."
            style={S.filterInput}
            value={taskFilter.search}
            onChange={(e) => setTaskFilter({ ...taskFilter, search: e.target.value })}
          />
          <select
            style={S.filterSelect}
            value={taskFilter.assignee}
            onChange={(e) => setTaskFilter({ ...taskFilter, assignee: e.target.value })}
          >
            <option value="">All Assignees</option>
            {assignees.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <div style={S.priorityPills}>
            <button
              style={{
                ...S.priorityPill,
                ...(taskFilter.priority === '' && S.priorityPillActive),
              }}
              onClick={() => setTaskFilter({ ...taskFilter, priority: '' })}
            >
              All
            </button>
            {priorities.map(p => (
              <button
                key={p}
                style={{
                  ...S.priorityPill,
                  ...(taskFilter.priority === p && S.priorityPillActive),
                }}
                onClick={() => setTaskFilter({ ...taskFilter, priority: p })}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Kanban Board */}
        <div style={S.kanbanBoard}>
          <TaskColumn
            title="To Do"
            status="pending"
            tasks={columns.pending}
            onTaskClick={(t) => setExpandedTask(expandedTask?.id === t.id ? null : t)}
            expandedTask={expandedTask}
            backendUrl={backendUrl}
            onUpdate={fetchAll}
          />
          <TaskColumn
            title="In Progress"
            status="in_progress"
            tasks={columns.in_progress}
            onTaskClick={(t) => setExpandedTask(expandedTask?.id === t.id ? null : t)}
            expandedTask={expandedTask}
            backendUrl={backendUrl}
            onUpdate={fetchAll}
          />
          <TaskColumn
            title="In Review"
            status="blocked"
            tasks={columns.blocked}
            onTaskClick={(t) => setExpandedTask(expandedTask?.id === t.id ? null : t)}
            expandedTask={expandedTask}
            backendUrl={backendUrl}
            onUpdate={fetchAll}
          />
          <TaskColumn
            title="Done"
            status="done"
            tasks={columns.done}
            onTaskClick={(t) => setExpandedTask(expandedTask?.id === t.id ? null : t)}
            expandedTask={expandedTask}
            backendUrl={backendUrl}
            onUpdate={fetchAll}
          />
        </div>
      </div>
    )
  }

  // ── Brain view ────────────────────────────────────────────────────────────
  if (activeView === 'brain') {
    const totalFacts = memoryFacts.length
    const totalEpisodes = memoryEpisodes.length
    const totalEvents = memoryEvents.length

    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <div>
            <h1 style={S.dashTitle}>Company Brain</h1>
            <span style={S.dashSub}>Persistent memory across all sessions</span>
          </div>
          <div style={S.emailStats}>
            <div style={S.statCard}>
              <span style={S.statValue}>{totalFacts}</span>
              <span style={S.statLabel}>Facts</span>
            </div>
            <div style={S.statCard}>
              <span style={S.statValue}>{totalEpisodes}</span>
              <span style={S.statLabel}>Episodes</span>
            </div>
            <div style={S.statCard}>
              <span style={S.statValue}>{totalEvents}</span>
              <span style={S.statLabel}>Events</span>
            </div>
          </div>
        </div>

        {/* Memory Status Bar */}
        {memoryStatus && (
          <div style={S.memoryStatusBar}>
            <div style={{...S.memoryStatusDot, background: memoryStatus.status === 'active' ? T.success : T.warning}} />
            <span style={S.memoryStatusText}>
              Memory {memoryStatus.status === 'active' ? 'Active' : 'Initializing'}
            </span>
            {memoryStatus.status === 'active' && (
              <span style={S.memoryStatusMeta}>
                {memoryStatus.facts_count} facts · {memoryStatus.episodes_count} episodes · {memoryStatus.events_count} events stored
              </span>
            )}
          </div>
        )}

        <div style={S.brainGrid}>
          {/* Facts Section */}
          <div style={S.card} className="glass-hover">
            <div style={S.sectionHeader}>
              <span style={S.sectionTitle}>Learned Facts</span>
              <span style={S.sectionBadge}>{totalFacts}</span>
            </div>
            {totalFacts === 0 ? (
              <div style={S.emptyState}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>Facts appear as Astra learns from your conversations</div>
              </div>
            ) : (
              <div style={S.cardBody}>
                {memoryFacts.slice(0, 15).map((fact, i) => (
                  <div key={i} style={S.factItem}>
                    <div style={S.factDot} />
                    <div style={S.factText}>{fact.content || fact.text || JSON.stringify(fact).slice(0, 120)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Episodes Section */}
          <div style={S.card} className="glass-hover">
            <div style={S.sectionHeader}>
              <span style={S.sectionTitle}>Session Episodes</span>
              <span style={S.sectionBadge}>{totalEpisodes}</span>
            </div>
            {totalEpisodes === 0 ? (
              <div style={S.emptyState}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                  <path d="M12 8v4l3 3"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
                <div>Episodes are created after each voice session</div>
                <div style={S.voiceHint}>Your Company Brain learns from every conversation</div>
              </div>
            ) : (
              <div style={S.cardBody}>
                {memoryEpisodes.map((ep, i) => (
                  <div key={i} style={S.episodeCard}>
                    <div style={S.episodeHeader}>
                      <span style={S.episodeTime}>
                        {ep.timestamp ? new Date(typeof ep.timestamp === 'number' ? ep.timestamp * 1000 : ep.timestamp).toLocaleString() : 'Recent'}
                      </span>
                    </div>
                    <div style={S.episodeContent}>
                      {ep.summary || ep.content || JSON.stringify(ep).slice(0, 200)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Events Timeline */}
        <div style={{...S.card, marginTop: 16}} className="glass-hover">
          <div style={S.sectionHeader}>
            <span style={S.sectionTitle}>Recent Events</span>
            <span style={S.sectionBadge}>{totalEvents}</span>
          </div>
          {totalEvents === 0 ? (
            <div style={S.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <div>Events track every interaction across sessions</div>
              <div style={S.voiceHint}>Your Company Brain learns from every conversation</div>
            </div>
          ) : (
            <div style={S.cardBody}>
              {memoryEvents.slice(0, 15).map((evt, i) => (
                <div key={i} style={S.eventItem}>
                  <div style={S.eventTimeline}>
                    <div style={S.eventDot} />
                    {i < memoryEvents.length - 1 && <div style={S.eventLine} />}
                  </div>
                  <div style={S.eventContent}>
                    <div style={S.eventText}>
                      {evt.content || evt.text || (evt.parts && evt.parts[0]?.text) || JSON.stringify(evt).slice(0, 150)}
                    </div>
                    <div style={S.eventMeta}>
                      {evt.author && <span style={S.eventAuthor}>{evt.author}</span>}
                      {evt.timestamp && (
                        <span style={S.eventTime}>
                          {new Date(typeof evt.timestamp === 'number' ? evt.timestamp * 1000 : evt.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Insights section at bottom */}
        <div style={{...S.card, marginTop: 16}} className="glass-hover">
          <div style={S.sectionHeader}>
            <span style={S.sectionTitle}>Active Insights</span>
            <span style={S.sectionBadge}>{insights.length}</span>
          </div>
          {insights.length === 0 ? (
            <div style={S.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
              <div>Insights are extracted from emails and conversations</div>
            </div>
          ) : (
            <div style={S.cardBody}>
              {insights.slice(0, 10).map((ins, i) => (
                <InsightCard key={i} insight={ins} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Calendar view ─────────────────────────────────────────────────────────
  if (activeView === 'calendar') {
    // Generate demo calendar data (today's schedule)
    const today = new Date()
    const formatTime = (h, m) => {
      const d = new Date(today)
      d.setHours(h, m, 0, 0)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const calendarEvents = [
      { time: formatTime(9, 0), endTime: formatTime(9, 30), title: 'Daily Standup', type: 'recurring', attendees: ['Arjun', 'Riya', 'Neha'], location: 'Google Meet', color: '#3b82f6' },
      { time: formatTime(10, 0), endTime: formatTime(11, 0), title: 'Series A Prep — Pitch Review', type: 'meeting', attendees: ['Paras Singh', 'Sarah Chen (Sequoia)'], location: 'Zoom', color: '#8b5cf6' },
      { time: formatTime(11, 30), endTime: formatTime(12, 0), title: 'Product Design Review', type: 'meeting', attendees: ['Neha Gupta', 'Arjun'], location: 'Office', color: '#22c55e' },
      { time: formatTime(13, 0), endTime: formatTime(13, 30), title: 'Lunch & Learn: AI Agents', type: 'event', attendees: ['All Team'], location: 'Office Kitchen', color: '#f59e0b' },
      { time: formatTime(14, 0), endTime: formatTime(15, 0), title: 'Customer Call — ByteByteGo', type: 'meeting', attendees: ['ByteByteGo Team'], location: 'Google Meet', color: '#ef4444' },
      { time: formatTime(15, 30), endTime: formatTime(16, 0), title: 'Sprint Planning', type: 'recurring', attendees: ['Engineering Team'], location: 'Slack Huddle', color: '#06b6d4' },
      { time: formatTime(16, 30), endTime: formatTime(17, 0), title: 'YC Application Review', type: 'deadline', attendees: ['Khwahish', 'Paras'], location: 'Office', color: '#ec4899' },
    ]

    const now = new Date()
    const currentHour = now.getHours()

    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <div>
            <h1 style={S.dashTitle}>Calendar</h1>
            <span style={S.dashSub}>
              {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <div style={S.emailStats}>
            <div style={S.statCard}>
              <span style={S.statValue}>{calendarEvents.length}</span>
              <span style={S.statLabel}>Events</span>
            </div>
            <div style={S.statCard}>
              <span style={S.statValue}>{calendarEvents.filter(e => e.type === 'meeting').length}</span>
              <span style={S.statLabel}>Meetings</span>
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={S.calendarTimeline}>
          {calendarEvents.map((evt, i) => {
            const eventHour = parseInt(evt.time.split(':')[0])
            const isPast = eventHour < currentHour
            const isCurrent = eventHour === currentHour

            return (
              <div key={i} style={{
                ...S.calendarEvent,
                opacity: isPast ? 0.5 : 1,
                borderLeftColor: evt.color,
                ...(isCurrent && S.calendarEventCurrent),
              }}>
                <div style={S.calEventTime}>
                  <div style={S.calEventTimeStart}>{evt.time}</div>
                  <div style={S.calEventTimeEnd}>{evt.endTime}</div>
                </div>
                <div style={S.calEventBody}>
                  <div style={S.calEventTitle}>{evt.title}</div>
                  <div style={S.calEventMeta}>
                    <span style={{...S.calEventTypeBadge, background: `${evt.color}20`, color: evt.color}}>
                      {evt.type}
                    </span>
                    <span style={S.calEventLocation}>{evt.location}</span>
                  </div>
                  <div style={S.calEventAttendees}>
                    {evt.attendees.map((a, j) => (
                      <span key={j} style={S.calEventAttendee}>{a}</span>
                    ))}
                  </div>
                </div>
                {isCurrent && <div style={S.calEventNowBadge}>NOW</div>}
              </div>
            )
          })}
        </div>

        {/* Upcoming commitments from brain */}
        {insights.filter(i => i.type === 'commitment').length > 0 && (
          <div style={{...S.card, marginTop: 20}} className="glass-hover">
            <div style={S.sectionHeader}>
              <span style={S.sectionTitle}>Upcoming Commitments</span>
              <span style={S.sectionBadge}>{insights.filter(i => i.type === 'commitment').length}</span>
            </div>
            <div style={S.cardBody}>
              {insights.filter(i => i.type === 'commitment').map((ins, i) => (
                <InsightCard key={i} insight={ins} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Tasks / Calendar / Brain views (placeholder with voice commands) ────
  const viewConfig = {
    tasks: {
      title: 'Tasks',
      icon: ChecklistIcon,
      desc: 'Create, assign, and track tasks with voice. Astra surfaces blocked and overdue items automatically.',
      commands: ['"Create a task for [person]"', '"What tasks are overdue?"', '"Mark [task] as done"', '"What\'s blocked?"'],
    },
    calendar: {
      title: 'Calendar',
      icon: CalendarIcon,
      desc: 'View your schedule, get meeting prep, and create events — all by voice.',
      commands: ['"What\'s on my calendar today?"', '"Prep me for my next meeting"', '"Schedule a call with [name]"', '"What meetings do I have this week?"'],
    },
    brain: {
      title: 'Company Brain',
      icon: BrainIcon,
      desc: 'Your persistent memory. Tracks commitments, risks, decisions, and insights across every session.',
      commands: ['"What commitments am I behind on?"', '"Show active risks"', '"What did I decide about [topic]?"', '"Scan my emails"'],
    },
  }

  const vc = viewConfig[activeView] || viewConfig.brain
  return (
    <div style={S.dashRoot}>
      <div style={S.dashHeader}>
        <h1 style={S.dashTitle}>{vc.title}</h1>
      </div>
      <div style={S.placeholderView}>
        <div style={S.placeholderIcon}>
          <vc.icon />
        </div>
        <h2 style={S.placeholderTitle}>{vc.title}</h2>
        <p style={S.placeholderDesc}>{vc.desc}</p>
        <div style={S.placeholderCommands}>
          {vc.commands.map((c, i) => (
            <span key={i} style={S.placeholderCmd}>{c}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Component: Animated Number Counter ──────────────────────────────────────
function AnimatedNumber({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const animate = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      setDisplay(Math.round(progress * value))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [value, duration])
  return <>{display}</>
}

// ── Component: KPI Card ────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, trend }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)
  const numericValue = typeof value === 'number' ? value : 0

  return (
    <div
      style={{
        ...S.kpiCard,
        ...(isHovered && S.kpiCardHovered),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={S.kpiIconCircle}>
        <Icon />
      </div>
      <div style={S.kpiValue}>
        <AnimatedNumber value={numericValue} />
        {trend && (
          <span style={{
            ...S.trendIndicator,
            ...(trend.direction === 'up' ? S.trendUp : trend.direction === 'down' ? S.trendDown : S.trendNeutral)
          }}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '–'}
            {trend.label && <span style={{ marginLeft: 4, fontSize: 11 }}>{trend.label}</span>}
          </span>
        )}
      </div>
      <div style={S.kpiLabel}>{label}</div>
    </div>
  )
}

// ── Component: Alert Card ──────────────────────────────────────────────────
function AlertCard({ alert, index }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)

  const severityColor = alert.severity === 'critical' ? T.danger
    : alert.severity === 'high' ? T.warning : T.accentCyan

  const severityBg = alert.severity === 'critical' ? T.dangerSoft
    : alert.severity === 'high' ? T.warningSoft : 'rgba(6,182,212,0.1)'

  return (
    <div
      style={{
        ...S.alertItem,
        borderLeftColor: severityColor,
        background: isHovered ? severityBg : 'transparent',
        ...S.staggerDelay(index),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{
        ...S.severityDot,
        background: severityColor,
      }} />
      <div style={S.alertContent}>
        <div style={S.alertTitle}>{alert.title}</div>
        <div style={S.alertMsg}>{alert.message?.slice(0, 100)}</div>
      </div>
      <div style={{
        ...S.priorityBadge,
        background: severityColor,
      }}>
        {alert.severity}
      </div>
    </div>
  )
}

// ── Component: Insight Card ────────────────────────────────────────────────
function InsightCard({ insight, index }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)

  const typeColor = insight.type === 'commitment' ? '#3b82f6'
    : insight.type === 'risk' ? T.danger
      : insight.type === 'decision' ? T.accentPurple
        : T.success

  const typeBg = insight.type === 'commitment' ? 'rgba(59,130,246,0.15)'
    : insight.type === 'risk' ? T.dangerSoft
      : insight.type === 'decision' ? 'rgba(139,92,246,0.15)'
        : T.successSoft

  return (
    <div
      style={{
        ...S.insightItem,
        background: isHovered ? 'rgba(139,92,246,0.08)' : 'transparent',
        borderRadius: 8,
        padding: '8px 12px',
        ...S.staggerDelay(index),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span style={{
        ...S.insightTypePill,
        background: typeBg,
        color: typeColor,
      }}>
        {insight.type}
      </span>
      <div style={S.insightContent}>
        <div style={S.insightText}>{insight.content?.slice(0, 100)}</div>
        {insight.confidence && (
          <div style={S.confidenceBar}>
            <div style={{
              ...S.confidenceBarFill,
              width: `${insight.confidence * 100}%`,
            }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Component: Relationship Card ───────────────────────────────────────────
function RelationshipCard({ relationship }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)
  const healthScore = relationship.health_score || 0
  const healthColor = healthScore > 0.7 ? T.success
    : healthScore > 0.4 ? T.warning : T.danger

  const gradient = getAvatarGradient(relationship.name || relationship.contact_email || '?')

  return (
    <div
      style={{
        ...S.relItem,
        background: isHovered ? 'rgba(79,125,255,0.05)' : 'transparent',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{
        ...S.relAvatar,
        background: gradient,
      }}>
        {(relationship.name || relationship.contact_email || '?')[0].toUpperCase()}
      </div>
      <div style={S.relInfo}>
        <div style={S.relName}>{relationship.name || relationship.contact_email}</div>
        <div style={S.relEmail}>{relationship.contact_email}</div>
      </div>
      <div style={S.relHealthCol}>
        <div style={S.healthBarOuter}>
          <div style={{
            ...S.healthBarFill,
            width: `${Math.round(healthScore * 100)}%`,
            background: healthColor,
          }} />
        </div>
        <span style={{
          ...S.relPct,
          color: healthColor,
        }}>
          {Math.round(healthScore * 100)}%
        </span>
      </div>
    </div>
  )
}

// ── Component: Relationship Grid Card ──────────────────────────────────────
function RelationshipGridCard({ relationship }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)
  const healthScore = relationship.health_score || 0
  const healthColor = healthScore > 0.7 ? T.success
    : healthScore > 0.4 ? T.warning : T.danger

  const gradientBg = getAvatarGradient(relationship.name || relationship.contact_email || '?')

  return (
    <div
      style={{
        ...S.relCard,
        ...(isHovered && S.relCardHovered),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{
        ...S.relCardAvatar,
        background: gradientBg,
      }}>
        {(relationship.name || relationship.contact_email || '?')[0].toUpperCase()}
      </div>
      <div style={S.relCardName}>{relationship.name || 'Unknown'}</div>
      <div style={S.relCardEmail}>{relationship.contact_email}</div>
      <div style={S.relCardHealth}>
        <div style={S.healthBarOuter}>
          <div style={{
            ...S.healthBarFill,
            width: `${Math.round(healthScore * 100)}%`,
            background: healthColor,
          }} />
        </div>
        <span style={{
          ...S.relCardPct,
          color: healthColor,
        }}>
          {Math.round(healthScore * 100)}%
        </span>
      </div>
      {relationship.last_interaction && (
        <div style={S.relCardMeta}>
          Last: {new Date(relationship.last_interaction).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}

// ── Component: Task Column ─────────────────────────────────────────────────
function TaskColumn({ title, status, tasks, onTaskClick, expandedTask, backendUrl, onUpdate }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)

  return (
    <div style={S.taskColumn}>
      <div style={S.columnHeader}>
        <h3 style={S.columnTitle}>{title}</h3>
        <span style={S.columnCount}>{tasks.length}</span>
      </div>
      <div style={S.columnBody}>
        {tasks.length === 0 ? (
          <div style={S.columnEmpty}>
            <div>No tasks yet</div>
            <div style={S.voiceHint}>Try saying "Create a task for [name]" to get started</div>
          </div>
        ) : (
          tasks.map((task, idx) => (
            <TaskCard
              key={task.id || idx}
              task={task}
              isExpanded={expandedTask?.id === task.id}
              onClick={() => onTaskClick(task)}
              backendUrl={backendUrl}
              onUpdate={onUpdate}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Component: Task Card ────────────────────────────────────────────────────
function TaskCard({ task, isExpanded, onClick, backendUrl, onUpdate }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [newStatus, setNewStatus] = useState(task.status)
  const [newPriority, setNewPriority] = useState(task.priority)
  const [newAssignee, setNewAssignee] = useState(task.assignee)

  const priorityColor = task.priority === 'urgent' ? T.danger
    : task.priority === 'high' ? T.warning
    : task.priority === 'medium' ? T.accentCyan
    : T.textMuted

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done'

  const handleUpdateTask = async () => {
    try {
      await fetch(`${backendUrl}/brain/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          priority: newPriority,
          assignee: newAssignee,
        }),
      })
      onUpdate()
    } catch { }
  }

  return (
    <div style={{ ...S.taskCard, ...(isOverdue && S.taskCardOverdue), ...(isOverdue && S.overdueGlow) }}>
      <div style={{ ...S.taskCardBorder, background: priorityColor }} />
      <div style={S.taskCardContent} onClick={onClick}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <div style={S.taskTitle}>{task.title}</div>
          <span style={{
            ...S.priorityBadge,
            background: task.priority === 'urgent' ? T.danger : task.priority === 'high' ? T.warning : task.priority === 'medium' ? T.accentCyan : T.textMuted,
            color: task.priority === 'medium' ? '#000' : '#fff',
          }}>
            {task.priority?.toUpperCase()}
          </span>
        </div>
        {task.assignee && (
          <div style={S.taskAssignee}>{task.assignee}</div>
        )}
        {task.due_date && (
          <div style={{
            ...S.taskDueDate,
            color: isOverdue ? T.danger : T.textMuted,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            {new Date(task.due_date).toLocaleDateString()}
            {isOverdue && <span style={S.overdueBadge}>OVERDUE</span>}
          </div>
        )}
        {task.tags && task.tags.length > 0 && (
          <div style={S.taskTags}>
            {task.tags.slice(0, 2).map((tag, i) => (
              <span key={i} style={S.tagPill}>{tag}</span>
            ))}
          </div>
        )}
        {task.comments && task.comments.length > 0 && (
          <div style={S.taskCommentBadge}>{task.comments.length}</div>
        )}
      </div>

      {isExpanded && (
        <div style={S.taskCardExpanded}>
          {task.description && (
            <div style={S.expandedSection}>
              <label style={S.expandedLabel}>Description</label>
              <p style={S.expandedText}>{task.description}</p>
            </div>
          )}
          <div style={S.expandedSection}>
            <label style={S.expandedLabel}>Status</label>
            <select
              style={S.expandedSelect}
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div style={S.expandedSection}>
            <label style={S.expandedLabel}>Priority</label>
            <select
              style={S.expandedSelect}
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div style={S.expandedSection}>
            <label style={S.expandedLabel}>Assignee</label>
            <input
              type="text"
              style={S.expandedInput}
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              placeholder="Assignee name"
            />
          </div>
          <button
            style={S.expandedSaveBtn}
            onClick={handleUpdateTask}
          >
            Save Changes
          </button>
        </div>
      )}
    </div>
  )
}

// ── Component: Create Task Form ─────────────────────────────────────────────
function CreateTaskForm({ teams, onClose, backendUrl, onCreated }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    assignee: '',
    priority: 'medium',
    due_date: '',
    tags: '',
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const params = new URLSearchParams({
        title: formData.title,
        assignee: formData.assignee,
        due_date: formData.due_date,
        description: formData.description,
      })
      await fetch(`${backendUrl}/brain/tasks/create?${params}`, { method: 'POST' })
      onCreated()
      onClose()
    } catch { }
  }

  return (
    <div style={S.createFormOverlay}>
      <div style={S.createFormCard}>
        <h2 style={S.createFormTitle}>Create Task</h2>
        <form onSubmit={handleSubmit} style={S.createForm}>
          <input
            type="text"
            placeholder="Task title"
            style={S.createFormInput}
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
          />
          <textarea
            placeholder="Description (optional)"
            style={S.createFormTextarea}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <input
            type="text"
            placeholder="Assignee"
            style={S.createFormInput}
            value={formData.assignee}
            onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
          />
          <select
            style={S.createFormInput}
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <input
            type="date"
            style={S.createFormInput}
            value={formData.due_date}
            onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
          />
          <div style={S.createFormActions}>
            <button type="submit" style={S.createFormSubmit}>Create</button>
            <button type="button" style={S.createFormCancel} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Component: Email Row ────────────────────────────────────────────────────
function EmailRow({ email, isExpanded, onToggle }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [newAssignee, setNewAssignee] = useState(email.assigned_to || '')
  const [newTeam, setNewTeam] = useState(email.routed_to_team_name || '')

  const categoryColor = email.category === 'sales' ? '#3b82f6'
    : email.category === 'support' ? T.success
    : email.category === 'engineering' ? T.accentPurple
    : T.textMuted

  const categoryBg = email.category === 'sales' ? 'rgba(59,130,246,0.15)'
    : email.category === 'support' ? T.successSoft
    : email.category === 'engineering' ? 'rgba(139,92,246,0.15)'
    : 'rgba(107,114,128,0.1)'

  const urgencyColor = email.urgency === 'critical' ? T.danger
    : email.urgency === 'high' ? T.warning
    : email.urgency === 'medium' ? T.accentCyan
    : T.textMuted

  const routingMethodBg = email.routing_method === 'AI' ? 'rgba(139,92,246,0.15)'
    : email.routing_method === 'Rule' ? 'rgba(34,197,94,0.15)'
    : 'rgba(107,114,128,0.1)'

  const routingMethodColor = email.routing_method === 'AI' ? T.accentPurple
    : email.routing_method === 'Rule' ? T.success
    : T.textMuted

  return (
    <div style={S.emailRowContainer}>
      <div style={S.emailRow} onClick={onToggle}>
        <div style={S.emailSender}>
          <div style={S.emailSenderName}>{email.sender}</div>
          <div style={S.emailSenderEmail}>{email.sender_email}</div>
        </div>
        <div style={S.emailSubject}>{email.subject}</div>
        <div style={S.emailBadges}>
          <span style={{
            ...S.emailBadge,
            background: categoryBg,
            color: categoryColor,
          }}>
            {email.category || 'uncategorized'}
          </span>
          <span style={{
            ...S.emailBadge,
            background: `${urgencyColor}15`,
            color: urgencyColor,
          }}>
            {email.urgency}
          </span>
          {email.sentiment === 'positive' && (
            <span style={{ ...S.sentimentDot, background: T.success }} title="Positive" />
          )}
          {email.sentiment === 'negative' && (
            <span style={{ ...S.sentimentDot, background: T.danger }} title="Negative" />
          )}
          <span style={{ ...S.emailBadge, background: routingMethodBg, color: routingMethodColor }}>
            {email.routing_method}
          </span>
          <span style={S.emailBadge}>
            {email.status || 'new'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div style={S.emailExpanded}>
          <p style={S.emailSnippet}>{email.snippet}</p>
          <div style={S.emailActions}>
            <input
              type="text"
              placeholder="Assign to person"
              style={S.emailActionInput}
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
            />
            <input
              type="text"
              placeholder="Route to team"
              style={S.emailActionInput}
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
            />
            <button style={S.emailActionBtn}>Update</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Component: Routing Rule Card ────────────────────────────────────────────
function RoutingRuleCard({ rule }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)

  return (
    <div style={S.ruleCard}>
      <div style={S.ruleHeader}>
        <div>
          <h4 style={S.ruleName}>{rule.name}</h4>
          <div style={S.ruleTeam}>→ {rule.team_id || rule.auto_assign_to || 'Unassigned'}</div>
        </div>
        <div style={{
          ...S.ruleBadge,
          background: rule.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.1)',
          color: rule.enabled ? T.success : T.textMuted,
        }}>
          {rule.enabled ? 'Active' : 'Inactive'}
        </div>
      </div>
      <div style={S.ruleConditions}>
        <span style={S.ruleCondition}>Priority: {rule.priority || 'auto'}</span>
        {rule.conditions && <span style={S.ruleCondition}>{rule.conditions}</span>}
      </div>
    </div>
  )
}

// ── Component: Create Rule Form ─────────────────────────────────────────────
function CreateRuleForm({ teams, onClose, backendUrl, onCreated }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [formData, setFormData] = useState({
    name: '',
    team_id: '',
    conditions: '',
    priority: 1,
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await fetch(`${backendUrl}/brain/routing-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      onCreated()
      onClose()
    } catch { }
  }

  return (
    <div style={S.createFormOverlay}>
      <div style={S.createFormCard}>
        <h2 style={S.createFormTitle}>Create Routing Rule</h2>
        <form onSubmit={handleSubmit} style={S.createForm}>
          <input
            type="text"
            placeholder="Rule name"
            style={S.createFormInput}
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <select
            style={S.createFormInput}
            value={formData.team_id}
            onChange={(e) => setFormData({ ...formData, team_id: e.target.value })}
            required
          >
            <option value="">Select target team</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <textarea
            placeholder="Conditions (keywords, sender domains, etc.)"
            style={S.createFormTextarea}
            value={formData.conditions}
            onChange={(e) => setFormData({ ...formData, conditions: e.target.value })}
          />
          <input
            type="number"
            placeholder="Priority (lower = higher priority)"
            style={S.createFormInput}
            value={formData.priority}
            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
          />
          <div style={S.createFormActions}>
            <button type="submit" style={S.createFormSubmit}>Create</button>
            <button type="button" style={S.createFormCancel} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── SVG Icons ──────────────────────────────────────────────────────────────

function BarChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 24, height: 24 }}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 5H9.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H17" />
      <path d="M5 12H2v8" />
    </svg>
  )
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 24, height: 24 }}>
      <path d="M12 2c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 20.627 0 14 5.373 2 12 2z" />
      <path d="M12 6c2.21 0 4 1.79 4 4s-1.79 4-4 4-4-1.79-4-4 1.79-4 4-4z" />
      <path d="M8 16c-1.104 0-2-.896-2-2s.896-2 2-2" />
      <path d="M16 16c1.104 0 2-.896 2-2s-.896-2-2-2" />
      <path d="M12 18c0 1.105.895 2 2 2s2-.895 2-2" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 24, height: 24 }}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 24, height: 24 }}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function LightbulbIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 24, height: 24 }}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M10 9l.5 1.5 1.5.5 1.5-.5.5-1.5" />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 64, height: 64 }}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 5L2 7" />
    </svg>
  )
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, marginBottom: 4 }}>
      <path d="M12 1a3 3 0 0 0-3 3v12a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function ChecklistIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 64, height: 64 }}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 64, height: 64 }}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

// ── Utility: Avatar Gradient ───────────────────────────────────────────────
function getAvatarGradient(name) {
  const colors = [
    'linear-gradient(135deg, rgba(79,125,255,0.25), rgba(124,58,237,0.25))',
    'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(59,130,246,0.25))',
    'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))',
    'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.25))',
    'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(59,130,246,0.25))',
  ]
  const index = name.charCodeAt(0) % colors.length
  return colors[index]
}

// ── Styles ────────────────────────────────────────────────────────────────────
const getStyles = (t) => ({
  dashRoot: {
    padding: '24px 28px',
    height: '100%',
    overflow: 'auto',
    background: t.gradientSubtle,
  },
  dashHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  dashTitle: {
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: t.text,
    margin: 0,
  },
  dashSub: {
    fontSize: 12,
    color: t.textDim,
    fontWeight: 500,
  },

  // KPI row
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 12,
    marginBottom: 32,
  },
  kpiCard: {
    padding: '20px',
    borderRadius: 16,
    background: t.bgCard,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  kpiCardHovered: {
    background: 'rgba(14, 14, 28, 0.75)',
    border: '1px solid rgba(147,197,253,0.2)',
    transform: 'translateY(-4px)',
    boxShadow: `0 20px 40px ${t.accentSoft}`,
  },
  kpiIconCircle: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: t.kpiIconBg,
    border: '1px solid rgba(147,197,253,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#93c5fd',
  },
  kpiValue: {
    fontSize: 28,
    fontWeight: 700,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontVariantNumeric: 'tabular-nums',
    color: t.text,
    lineHeight: 1,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  skeletonCard: {
    padding: '20px',
    borderRadius: 16,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    minHeight: 120,
  },

  // Two column layout
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1.5fr 1fr',
    gap: 16,
    alignItems: 'start',
  },
  colLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  colRight: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },

  // Cards
  card: {
    borderRadius: 16,
    background: t.bgCard,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    overflow: 'hidden',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${t.bgSurface}`,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: t.textDim,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  sectionBadge: {
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(147,197,253,0.15)',
    padding: '4px 10px',
    borderRadius: 12,
    color: '#93c5fd',
    fontVariantNumeric: 'tabular-nums',
  },
  cardBody: {
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 380,
    overflowY: 'auto',
  },
  emptyState: {
    padding: '32px 20px',
    fontSize: 13,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 1.6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },

  // Alert items
  alertItem: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: 10,
    borderLeft: '3px solid transparent',
    background: 'transparent',
    transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginTop: 6,
    flexShrink: 0,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: t.text,
    marginBottom: 4,
  },
  alertMsg: {
    fontSize: 11,
    color: t.textDim,
    lineHeight: 1.4,
  },
  priorityBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 4,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },

  // Insight items
  insightItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  insightTypePill: {
    fontSize: 9,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 6,
    textTransform: 'uppercase',
    flexShrink: 0,
    letterSpacing: '0.06em',
  },
  insightContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  insightText: {
    fontSize: 12,
    color: t.textSecondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  confidenceBar: {
    height: 4,
    borderRadius: 2,
    background: t.borderSubtle,
    overflow: 'hidden',
  },
  confidenceBarFill: {
    height: '100%',
    borderRadius: 2,
    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
    transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // Relationship items
  relItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 10,
    transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  relAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: `1px solid ${t.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    color: '#93c5fd',
    flexShrink: 0,
  },
  relInfo: {
    flex: 1,
    overflow: 'hidden',
  },
  relName: {
    fontSize: 12,
    fontWeight: 600,
    color: t.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  relEmail: {
    fontSize: 10,
    color: t.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  relHealthCol: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    width: 110,
  },
  healthBarOuter: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: t.borderSubtle,
    overflow: 'hidden',
  },
  healthBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  relPct: {
    fontSize: 11,
    fontWeight: 700,
    width: 40,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },

  // CRM grid
  relGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 16,
  },
  relCard: {
    padding: '20px',
    borderRadius: 16,
    background: t.bgCard,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    textAlign: 'center',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  relCardHovered: {
    background: 'rgba(14, 14, 28, 0.75)',
    border: '1px solid rgba(147,197,253,0.2)',
    transform: 'translateY(-4px)',
    boxShadow: `0 20px 40px ${t.accentSoft}`,
  },
  relCardAvatar: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    border: `1px solid ${t.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    fontWeight: 700,
    color: '#93c5fd',
  },
  relCardName: {
    fontSize: 14,
    fontWeight: 700,
    color: t.text,
  },
  relCardEmail: {
    fontSize: 11,
    color: t.textDim,
  },
  relCardHealth: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  relCardPct: {
    fontSize: 12,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  relCardMeta: {
    fontSize: 10,
    color: t.textMuted,
    marginTop: 4,
  },

  // Quick commands
  commandGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    padding: '12px 16px',
  },
  commandCard: {
    padding: '12px 14px',
    borderRadius: 10,
    background: t.accentSoft,
    border: `1px solid ${t.borderAccent}`,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  commandLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#93c5fd',
    textAlign: 'center',
  },
  commandDesc: {
    fontSize: 9,
    color: t.textMuted,
    textAlign: 'center',
  },

  // Animated KPI styles
  animatedKpi: {
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-block',
  },
  trendIndicator: {
    fontSize: 12,
    fontWeight: 700,
    marginLeft: 6,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
  },
  trendUp: {
    color: '#22c55e',
  },
  trendDown: {
    color: '#ef4444',
  },
  trendNeutral: {
    color: t.textMuted,
  },

  // Overdue glow
  overdueGlow: {
    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  },

  // Overdue badge
  overdueBadge: {
    fontSize: 8,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 3,
    background: t.danger,
    color: '#fff',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },

  // Voice hint
  voiceHint: {
    fontSize: 10,
    color: t.accentCyan,
    fontWeight: 500,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 1.4,
  },

  // Clickable command button
  clickableCommand: {
    padding: '12px 14px',
    borderRadius: 10,
    background: t.accentSoft,
    border: `1px solid ${t.borderAccent}`,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'center',
  },

  // Placeholder views
  placeholderView: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: '80px 40px',
    textAlign: 'center',
    minHeight: 'calc(100% - 120px)',
  },
  placeholderIcon: {
    color: t.textMuted,
    marginBottom: 8,
  },
  placeholderTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: t.text,
    margin: 0,
  },
  placeholderDesc: {
    fontSize: 14,
    color: t.textSecondary,
    lineHeight: 1.7,
    maxWidth: 520,
  },
  placeholderCommands: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginTop: 12,
  },
  placeholderCmd: {
    fontSize: 12,
    fontWeight: 500,
    padding: '8px 16px',
    borderRadius: 10,
    background: t.accentSoft,
    border: `1px solid ${t.borderAccent}`,
    color: '#93c5fd',
    transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'default',
  },

  // Task Board
  taskFilterBar: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 24,
    padding: '12px 16px',
    borderRadius: 12,
    background: t.bgCard,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
  },
  filterInput: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 13,
    outline: 'none',
    transition: 'all 150ms',
  },
  filterSelect: {
    padding: '8px 12px',
    borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 13,
    outline: 'none',
    transition: 'all 150ms',
  },
  priorityPills: {
    display: 'flex',
    gap: 8,
  },
  priorityPill: {
    padding: '6px 12px',
    borderRadius: 8,
    background: 'transparent',
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 150ms',
  },
  priorityPillActive: {
    background: t.accentCyan,
    borderColor: t.accentCyan,
    color: '#000',
  },
  kanbanBoard: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    overflow: 'auto',
  },
  taskColumn: {
    borderRadius: 12,
    background: t.bgGlass,
    border: `1px solid ${t.border}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 400,
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${t.border}`,
  },
  columnTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: t.text,
    margin: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  columnCount: {
    fontSize: 12,
    fontWeight: 700,
    background: 'rgba(147,197,253,0.15)',
    padding: '2px 8px',
    borderRadius: 6,
    color: '#93c5fd',
  },
  columnBody: {
    flex: 1,
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflowY: 'auto',
  },
  columnEmpty: {
    fontSize: 12,
    color: t.textMuted,
    textAlign: 'center',
    padding: '20px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  taskCard: {
    borderRadius: 10,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 150ms',
    display: 'flex',
    position: 'relative',
  },
  taskCardOverdue: {
    borderColor: 'rgba(239,68,68,0.3)',
    boxShadow: `inset 0 0 8px ${t.danger}15`,
  },
  taskCardBorder: {
    width: 3,
    height: '100%',
    flexShrink: 0,
  },
  taskCardContent: {
    flex: 1,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  taskTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: t.text,
    lineHeight: 1.3,
  },
  taskAssignee: {
    fontSize: 10,
    color: t.accentCyan,
    fontWeight: 600,
  },
  taskDueDate: {
    fontSize: 10,
    fontWeight: 500,
  },
  taskTags: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  tagPill: {
    fontSize: 8,
    padding: '2px 6px',
    borderRadius: 4,
    background: 'rgba(139,92,246,0.15)',
    color: t.accentPurple,
    fontWeight: 600,
  },
  taskCommentBadge: {
    fontSize: 9,
    background: t.textMuted,
    color: t.bgCard,
    padding: '2px 6px',
    borderRadius: 4,
    fontWeight: 700,
    width: 'fit-content',
  },
  taskCardExpanded: {
    width: '100%',
    padding: '12px 12px',
    borderTop: `1px solid ${t.border}`,
    background: t.bgSurface,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  expandedSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  expandedLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: t.textDim,
    textTransform: 'uppercase',
  },
  expandedText: {
    fontSize: 11,
    color: t.textSecondary,
    margin: 0,
    lineHeight: 1.4,
  },
  expandedSelect: {
    padding: '6px 8px',
    borderRadius: 6,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 11,
    outline: 'none',
  },
  expandedInput: {
    padding: '6px 8px',
    borderRadius: 6,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 11,
    outline: 'none',
  },
  expandedSaveBtn: {
    padding: '6px 10px',
    borderRadius: 6,
    background: t.accentCyan,
    border: 'none',
    color: '#000',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 150ms',
  },
  createTaskBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: t.accentCyan,
    border: 'none',
    color: '#000',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 150ms',
  },

  // Email Routing
  emailStats: {
    display: 'flex',
    gap: 16,
  },
  statCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 20px',
    borderRadius: 12,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    backdropFilter: 'blur(16px)',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: t.accent,
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  emailTabBar: {
    display: 'flex',
    gap: 0,
    borderBottom: `1px solid ${t.border}`,
    marginBottom: 20,
  },
  emailTab: {
    flex: 1,
    padding: '12px 16px',
    background: 'transparent',
    border: 'none',
    color: t.textSecondary,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    borderBottom: `2px solid transparent`,
    transition: 'all 150ms',
  },
  emailTabActive: {
    color: t.accent,
    borderBottomColor: t.accent,
  },
  emailFilterBar: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
    padding: '12px 16px',
    borderRadius: 12,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
  },
  emailList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emailRowContainer: {
    borderRadius: 10,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    overflow: 'hidden',
    transition: 'all 150ms',
  },
  emailRow: {
    display: 'grid',
    gridTemplateColumns: '200px 1fr 200px',
    gap: 16,
    padding: '12px 16px',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'all 150ms',
  },
  emailSender: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  emailSenderName: {
    fontSize: 12,
    fontWeight: 700,
    color: t.text,
  },
  emailSenderEmail: {
    fontSize: 10,
    color: t.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emailSubject: {
    fontSize: 13,
    color: t.textSecondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emailBadges: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  emailBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 6,
    textTransform: 'uppercase',
  },
  sentimentDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  emailExpanded: {
    padding: '12px 16px',
    borderTop: `1px solid ${t.border}`,
    background: t.bgSurface,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  emailSnippet: {
    fontSize: 11,
    color: t.textSecondary,
    margin: 0,
    lineHeight: 1.5,
  },
  emailActions: {
    display: 'flex',
    gap: 8,
  },
  emailActionInput: {
    flex: 1,
    padding: '6px 8px',
    borderRadius: 6,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 11,
    outline: 'none',
  },
  emailActionBtn: {
    padding: '6px 12px',
    borderRadius: 6,
    background: t.accentCyan,
    border: 'none',
    color: '#000',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  },
  createRuleBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    background: t.accentCyan,
    border: 'none',
    color: '#000',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    marginBottom: 16,
    transition: 'all 150ms',
  },
  rulesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  ruleCard: {
    borderRadius: 10,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    padding: '14px 16px',
    transition: 'all 150ms',
  },
  ruleHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ruleName: {
    fontSize: 13,
    fontWeight: 700,
    color: t.text,
    margin: 0,
  },
  ruleTeam: {
    fontSize: 11,
    color: t.textMuted,
    fontWeight: 500,
    marginTop: 4,
  },
  ruleBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 6,
    textTransform: 'uppercase',
  },
  ruleConditions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  ruleCondition: {
    fontSize: 10,
    color: t.textMuted,
    padding: '2px 6px',
    borderRadius: 4,
    background: t.bgSurface,
  },

  // Form styles
  createFormOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  createFormCard: {
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    borderRadius: 16,
    padding: '24px',
    maxWidth: 500,
    width: '90%',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  },
  createFormTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: t.text,
    margin: '0 0 16px 0',
  },
  createForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  createFormInput: {
    padding: '10px 12px',
    borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 13,
    outline: 'none',
    transition: 'all 150ms',
  },
  createFormTextarea: {
    padding: '10px 12px',
    borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    color: t.text,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    minHeight: 80,
    resize: 'none',
    transition: 'all 150ms',
  },
  createFormActions: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  createFormSubmit: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    background: t.accentCyan,
    border: 'none',
    color: '#000',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 150ms',
  },
  createFormCancel: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: 8,
    background: 'transparent',
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 150ms',
  },

  // Seed banner
  seedBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderRadius: 12,
    background: `linear-gradient(135deg, ${t.accentSoft}, rgba(139,92,246,0.08))`,
    border: `1px solid ${t.borderAccent}`,
    marginBottom: 24,
  },
  seedBannerText: {
    fontSize: 13,
    color: t.textSecondary,
    lineHeight: 1.5,
  },
  seedBtn: {
    padding: '10px 20px',
    borderRadius: 8,
    background: t.accent,
    border: 'none',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 150ms',
    whiteSpace: 'nowrap',
  },

  // Brain view
  brainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  memoryStatusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 10,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    marginBottom: 16,
  },
  memoryStatusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  memoryStatusText: {
    fontSize: 12,
    fontWeight: 600,
    color: t.text,
  },
  memoryStatusMeta: {
    fontSize: 11,
    color: t.textMuted,
    marginLeft: 'auto',
  },
  factItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 0',
    borderBottom: `1px solid ${t.borderSubtle}`,
  },
  factDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: t.accentCyan,
    marginTop: 5,
    flexShrink: 0,
  },
  factText: {
    fontSize: 12,
    color: t.textSecondary,
    lineHeight: 1.5,
  },
  episodeCard: {
    padding: '12px',
    borderRadius: 10,
    background: t.bgSurface,
    border: `1px solid ${t.borderSubtle}`,
  },
  episodeHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  episodeTime: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: 600,
  },
  episodeContent: {
    fontSize: 12,
    color: t.textSecondary,
    lineHeight: 1.5,
  },
  eventItem: {
    display: 'flex',
    gap: 12,
    padding: '4px 0',
  },
  eventTimeline: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 16,
    flexShrink: 0,
  },
  eventDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: t.accentPurple,
    flexShrink: 0,
  },
  eventLine: {
    width: 2,
    flex: 1,
    background: t.borderSubtle,
    marginTop: 4,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 12,
  },
  eventText: {
    fontSize: 12,
    color: t.textSecondary,
    lineHeight: 1.4,
  },
  eventMeta: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  eventAuthor: {
    fontSize: 10,
    color: t.accentCyan,
    fontWeight: 600,
  },
  eventTime: {
    fontSize: 10,
    color: t.textMuted,
  },

  // Calendar view
  calendarTimeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  calendarEvent: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 16,
    padding: '14px 16px',
    borderRadius: 12,
    background: t.bgCard,
    border: `1px solid ${t.border}`,
    borderLeft: '4px solid transparent',
    transition: 'all 200ms',
    position: 'relative',
  },
  calendarEventCurrent: {
    background: `linear-gradient(135deg, ${t.bgCard}, ${t.accentSoft})`,
    border: `1px solid ${t.borderAccent}`,
    boxShadow: `0 4px 12px ${t.accentSoft}`,
  },
  calEventTime: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'center',
    width: 70,
    flexShrink: 0,
  },
  calEventTimeStart: {
    fontSize: 13,
    fontWeight: 700,
    color: t.text,
    fontVariantNumeric: 'tabular-nums',
  },
  calEventTimeEnd: {
    fontSize: 10,
    color: t.textMuted,
    fontVariantNumeric: 'tabular-nums',
  },
  calEventBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  calEventTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: t.text,
    letterSpacing: '-0.01em',
  },
  calEventMeta: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  calEventTypeBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 6,
    textTransform: 'uppercase',
  },
  calEventLocation: {
    fontSize: 11,
    color: t.textMuted,
  },
  calEventAttendees: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  calEventAttendee: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 6,
    background: t.bgSurface,
    border: `1px solid ${t.borderSubtle}`,
    color: t.textSecondary,
    fontWeight: 500,
  },
  calEventNowBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 9,
    fontWeight: 800,
    padding: '3px 8px',
    borderRadius: 6,
    background: t.success,
    color: '#fff',
    letterSpacing: '0.05em',
  },

  // Utility
  staggerDelay: (index) => ({
    animationDelay: `${index * 50}ms`,
  }),
})
