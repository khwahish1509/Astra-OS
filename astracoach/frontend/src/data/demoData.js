/**
 * demoData.js — Curated demo data for Astra OS
 * Used when backend is not connected or returns empty.
 */

export const DEMO_SUMMARY = {
  active_insights: 14, insight_breakdown: { commitment: 3, risk: 2, decision: 2, action_item: 2, opportunity: 1 },
  overdue_commitments: 2, at_risk_contacts: 3, open_tasks: 6, pending_alerts: 5,
}

export const DEMO_ALERTS = [
  { id: 'a1', title: 'Overdue: Financials for Sarah Chen', message: 'You promised updated financials to Sarah Chen by Friday. It\'s now 2 days overdue. She may be waiting on this for investment decisions.', severity: 'critical', related_contact: 'sarah@sequoia.vc' },
  { id: 'a2', title: 'Relationship at risk: Alex Thompson', message: 'Your relationship health with Alex Thompson is declining (score: 0.45). He hasn\'t heard from you in 5+ days.', severity: 'high', related_contact: 'alex@ycombinator.com' },
  { id: 'a3', title: 'Sprint velocity declining', message: 'Engineering team velocity dropped 20% last week. This could indicate burnout or blockers.', severity: 'high' },
  { id: 'a4', title: 'ByteByteGo MVP deadline in 4 days', message: 'You committed to deliver MVP demo to ByteByteGo by March 20. That\'s 4 days away.', severity: 'medium', related_contact: 'team@bytebytego.com' },
  { id: 'a5', title: '3 unanswered emails from Neha', message: 'Neha has sent 3 emails in the past 48 hours without responses. Internal communication gap detected.', severity: 'medium', related_contact: 'neha@astra.ai' },
]

export const DEMO_RELATIONSHIPS = [
  { contact_email: 'paras@astra.ai', name: 'Paras Singh', health_score: 0.92, tone_trend: 'positive', interaction_count: 23, last_interaction: '2026-03-15' },
  { contact_email: 'sarah@sequoia.vc', name: 'Sarah Chen', health_score: 0.78, tone_trend: 'positive', interaction_count: 8, last_interaction: '2026-03-14' },
  { contact_email: 'riya@astra.ai', name: 'Riya Sharma', health_score: 0.88, tone_trend: 'positive', interaction_count: 31, last_interaction: '2026-03-16' },
  { contact_email: 'neha@astra.ai', name: 'Neha Gupta', health_score: 0.71, tone_trend: 'declining', interaction_count: 15, last_interaction: '2026-03-13' },
  { contact_email: 'team@bytebytego.com', name: 'ByteByteGo', health_score: 0.65, tone_trend: 'neutral', interaction_count: 12, last_interaction: '2026-03-11' },
  { contact_email: 'alex@ycombinator.com', name: 'Alex Thompson', health_score: 0.45, tone_trend: 'negative', interaction_count: 5, last_interaction: '2026-03-09' },
]

export const DEMO_INSIGHTS = [
  { id: 'i1', type: 'commitment', content: 'Promised to send updated financials to Sarah Chen by Friday', parties: ['sarah@sequoia.vc'], due_date: '2026-03-18', source: 'email', confidence: 0.92 },
  { id: 'i2', type: 'risk', content: 'ByteByteGo engagement declining — last 3 emails unanswered for 5+ days', parties: ['team@bytebytego.com'], source: 'email', confidence: 0.87 },
  { id: 'i3', type: 'decision', content: 'Decided to pivot pricing model from per-seat to usage-based', parties: ['paras@astra.ai'], source: 'meeting', confidence: 0.95 },
  { id: 'i4', type: 'action_item', content: 'Schedule follow-up call with Alex Thompson re: YC application', parties: ['alex@ycombinator.com'], due_date: '2026-03-19', source: 'email', confidence: 0.84 },
  { id: 'i5', type: 'opportunity', content: 'Sarah mentioned Sequoia is looking at AI-native productivity tools', parties: ['sarah@sequoia.vc'], source: 'email', confidence: 0.78 },
  { id: 'i6', type: 'commitment', content: 'Agreed to deliver MVP demo to ByteByteGo by March 20', parties: ['team@bytebytego.com'], due_date: '2026-03-20', source: 'email', confidence: 0.9 },
  { id: 'i7', type: 'risk', content: 'Sprint velocity dropped 20% last week — team may be burning out', parties: [], source: 'meeting', confidence: 0.83 },
  { id: 'i8', type: 'decision', content: 'Chose Google Cloud + Firestore over AWS for infrastructure', parties: ['paras@astra.ai', 'riya@astra.ai'], source: 'meeting', confidence: 0.97 },
]

export const DEMO_TASKS = [
  { id: 't1', title: 'Finalize Series A pitch deck', description: 'Complete and polish the Series A pitch deck for investor meetings', assignee: 'Khwahish', due_date: '2026-03-17', status: 'pending', priority: 'urgent', tags: ['fundraising', 'priority'] },
  { id: 't2', title: 'Review Q1 revenue projections', description: 'Review and validate Q1 revenue projections with finance team', assignee: 'Paras', due_date: '2026-03-18', status: 'in_progress', priority: 'high', tags: ['finance'] },
  { id: 't3', title: 'Ship onboarding flow v2', description: 'Deploy updated onboarding flow to production', assignee: 'Arjun', due_date: '2026-03-19', status: 'in_progress', priority: 'high', tags: ['product', 'frontend'] },
  { id: 't4', title: 'Fix authentication timeout bug', description: 'Resolve the authentication timeout issue reported by users', assignee: 'Riya', due_date: '2026-03-16', status: 'pending', priority: 'urgent', tags: ['engineering', 'bug'] },
  { id: 't5', title: 'Prepare investor update email', description: 'Monthly investor update with key metrics and milestones', assignee: 'Khwahish', due_date: '2026-03-21', status: 'blocked', priority: 'medium', tags: ['fundraising'] },
  { id: 't6', title: 'Design new landing page mockups', description: 'Create mockups for redesigned landing page', assignee: 'Neha', due_date: '2026-03-23', status: 'pending', priority: 'medium', tags: ['design'] },
  { id: 't7', title: 'Set up CI/CD pipeline', description: 'GitHub Actions CI/CD for automated deployments', assignee: 'Arjun', status: 'done', priority: 'low', tags: ['devops'], completed_at: Date.now() / 1000 - 1209600 },
  { id: 't8', title: 'Customer interview — ByteByteGo', description: 'Conduct customer interview with ByteByteGo team', assignee: 'Khwahish', status: 'done', priority: 'high', tags: ['research'], completed_at: Date.now() / 1000 - 604800 },
]

export const DEMO_TEAMS = [
  { id: 'team_eng', name: 'Engineering', members: [{ name: 'Arjun', email: 'arjun@astra.ai', role: 'lead' }, { name: 'Riya', email: 'riya@astra.ai', role: 'backend' }], color: '#3b82f6' },
  { id: 'team_design', name: 'Design', members: [{ name: 'Neha', email: 'neha@astra.ai', role: 'lead' }], color: '#8b5cf6' },
  { id: 'team_sales', name: 'Sales & Growth', members: [{ name: 'Khwahish', email: 'khwahish@astra.ai', role: 'lead' }, { name: 'Paras', email: 'paras@astra.ai', role: 'growth' }], color: '#22c55e' },
]

export const DEMO_ROUTED_EMAILS = [
  { id: 'e1', sender: 'Sarah Chen', sender_email: 'sarah@sequoia.vc', subject: 'Re: Series A Timeline', snippet: 'When can we set up the follow-up meeting? Excited about your metrics and want to bring this to our Monday partner meeting.', category: 'sales', confidence: 0.95, urgency: 'high', sentiment: 'positive', routed_to_team_name: 'Sales & Growth', routing_method: 'ai', status: 'new' },
  { id: 'e2', sender: 'GitHub Alerts', sender_email: 'noreply@github.com', subject: 'Critical vulnerability in dependency', snippet: 'A critical security vulnerability was found in one of your dependencies. Please update lodash to 4.17.21 immediately.', category: 'engineering', confidence: 0.99, urgency: 'critical', sentiment: 'negative', routed_to_team_name: 'Engineering', routing_method: 'rule', status: 'new' },
  { id: 'e3', sender: 'Alex Thompson', sender_email: 'alex@ycombinator.com', subject: 'YC Application Follow-up', snippet: 'Hi, just checking in on the status of your application. Would love to schedule a quick call to discuss next steps.', category: 'sales', confidence: 0.87, urgency: 'medium', sentiment: 'neutral', routed_to_team_name: 'Sales & Growth', routing_method: 'ai', status: 'new' },
  { id: 'e4', sender: 'Stripe', sender_email: 'notifications@stripe.com', subject: 'Monthly revenue report ready', snippet: 'Your monthly revenue report for February is ready. Total processed: $48,200. View your full dashboard for details.', category: 'finance', confidence: 0.99, urgency: 'low', sentiment: 'positive', routing_method: 'ai', status: 'new' },
  { id: 'e5', sender: 'Intercom', sender_email: 'support@intercom.io', subject: 'New support ticket: Login issue', snippet: 'User reports they cannot login. Error: Session timeout. Affects 5 users in the last 2 hours.', category: 'support', confidence: 0.92, urgency: 'high', sentiment: 'negative', routed_to_team_name: 'Engineering', routing_method: 'rule', status: 'assigned' },
  { id: 'e6', sender: 'Neha Gupta', sender_email: 'neha@astra.ai', subject: 'Landing page mockups ready for review', snippet: 'I\'ve finished the landing page redesign mockups. Attached are 3 options. Ready for your feedback whenever you have time!', category: 'personal', confidence: 0.88, urgency: 'medium', sentiment: 'positive', routed_to_team_name: 'Design', routing_method: 'ai', status: 'new' },
]

export const DEMO_ROUTING_RULES = [
  { id: 'r1', name: 'Investor Emails', team_id: 'team_sales', conditions: { category: 'sales', sender_domains: ['sequoia.vc', 'ycombinator.com'] }, priority: 1, enabled: true },
  { id: 'r2', name: 'Bug Reports', team_id: 'team_eng', conditions: { category: 'support', keywords: ['bug', 'error', 'crash'] }, priority: 2, enabled: true },
  { id: 'r3', name: 'Design Feedback', team_id: 'team_design', conditions: { category: 'support', keywords: ['design', 'mockup', 'UI', 'UX'] }, priority: 3, enabled: true },
]

export const DEMO_MEMORY_FACTS = [
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

export const DEMO_MEMORY_EPISODES = [
  { summary: 'Discussed Series A strategy with Paras. Decided to target $2M raise with 15% dilution. Sarah Chen at Sequoia is warm lead.', timestamp: Date.now() / 1000 - 86400 },
  { summary: 'Sprint planning session. Arjun flagged onboarding flow v2 as behind schedule. Riya making good progress on auth fixes.', timestamp: Date.now() / 1000 - 172800 },
  { summary: 'Customer call with ByteByteGo. They want to see a working MVP by March 20. Committed to delivery date.', timestamp: Date.now() / 1000 - 259200 },
  { summary: 'Reviewed landing page mockups from Neha. Option B looks strongest. Need to iterate on hero section copy.', timestamp: Date.now() / 1000 - 345600 },
  { summary: 'Weekly all-hands. Shared revenue milestone ($48K MRR). Team morale is good but engineering velocity needs monitoring.', timestamp: Date.now() / 1000 - 432000 },
]

export const DEMO_MEMORY_EVENTS = [
  { content: 'Founder asked about Series A timeline and investor pipeline', author: 'user', timestamp: Date.now() / 1000 - 3600 },
  { content: 'Provided briefing on 3 active investor conversations and next steps', author: 'assistant', timestamp: Date.now() / 1000 - 3500 },
  { content: 'Created task: Finalize Series A pitch deck (urgent, assigned to Khwahish)', author: 'assistant', timestamp: Date.now() / 1000 - 7200 },
  { content: 'Scanned inbox: found 6 emails requiring attention, 1 critical from GitHub', author: 'assistant', timestamp: Date.now() / 1000 - 14400 },
  { content: 'Detected declining relationship health with Alex Thompson (YC)', author: 'system', timestamp: Date.now() / 1000 - 28800 },
  { content: 'Generated weekly digest: 14 active insights, 5 pending alerts, 6 open tasks', author: 'assistant', timestamp: Date.now() / 1000 - 43200 },
  { content: 'Founder discussed pricing strategy — decided to pivot to usage-based model', author: 'user', timestamp: Date.now() / 1000 - 86400 },
  { content: 'Updated Company Brain with pricing decision and notified relevant team members', author: 'assistant', timestamp: Date.now() / 1000 - 86300 },
]

export const DEMO_MEMORY_STATUS = { status: 'active', facts_count: 12, episodes_count: 5, events_count: 8 }
