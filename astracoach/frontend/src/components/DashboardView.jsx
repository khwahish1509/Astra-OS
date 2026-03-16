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
  const timerRef = useRef(null)

  const { theme: T } = useTheme()
  const S = getStyles(T)

  const fetchAll = useCallback(async () => {
    try {
      const [sumRes, alertRes, relRes, insightRes, taskRes, teamRes, emailRes, ruleRes] = await Promise.all([
        fetch(`${backendUrl}/brain/summary`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/brain/alerts?severity=medium`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/relationships`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/insights?limit=10`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/tasks/all`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/teams`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/emails/routed?limit=50`).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${backendUrl}/brain/routing-rules`).then(r => r.ok ? r.json() : []).catch(() => []),
      ])
      if (sumRes) setSummary(sumRes)
      setAlerts(alertRes || [])
      setRelationships(relRes || [])
      setInsights(insightRes || [])
      setTasks(taskRes || [])
      setTeams(teamRes || [])
      setRoutedEmails(emailRes || [])
      setRoutingRules(ruleRes || [])
    } catch { }
    setLoading(false)
  }, [backendUrl])

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
    `
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
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
            />
          </div>
          <div className="stagger-2">
            <KpiCard
              label="Brain Events"
              value={summary?.open_tasks ?? '—'}
              icon={BrainIcon}
            />
          </div>
          <div className="stagger-3">
            <KpiCard
              label="Relationships"
              value={summary?.at_risk_contacts ?? '—'}
              icon={PeopleIcon}
            />
          </div>
          <div className="stagger-4">
            <KpiCard
              label="Active Alerts"
              value={summary?.pending_alerts ?? '—'}
              icon={BellIcon}
            />
          </div>
          <div className="stagger-5">
            <KpiCard
              label="Insights"
              value={summary?.overdue_commitments ?? '—'}
              icon={LightbulbIcon}
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
                  <div key={i} style={S.commandCard} className="command-hover">
                    <MicrophoneIcon />
                    <div style={S.commandLabel}>{cmd.label}</div>
                    <div style={S.commandDesc}>{cmd.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Email Routing view ──────────────────────────────────────────────────
  if (activeView === 'email') {
    const filteredEmails = routedEmails.filter(e => {
      if (emailFilter.category && e.category !== emailFilter.category) return false
      if (emailFilter.urgency && e.urgency !== emailFilter.urgency) return false
      if (emailFilter.team && e.routed_to_team_name !== emailFilter.team) return false
      if (emailFilter.status && e.status !== emailFilter.status) return false
      return true
    })

    const statsByCategory = routedEmails.reduce((acc, e) => {
      acc[e.category || 'uncategorized'] = (acc[e.category || 'uncategorized'] || 0) + 1
      return acc
    }, {})

    return (
      <div style={S.dashRoot}>
        <div style={S.dashHeader}>
          <div>
            <h1 style={S.dashTitle}>Email Routing</h1>
            <span style={S.dashSub}>AI-powered inbox intelligence</span>
          </div>
          <div style={S.emailStats}>
            <div style={S.statCard}>
              <span style={S.statValue}>{routedEmails.length}</span>
              <span style={S.statLabel}>Routed</span>
            </div>
            <div style={S.statCard}>
              <span style={S.statValue}>{Object.keys(statsByCategory).length}</span>
              <span style={S.statLabel}>Categories</span>
            </div>
            <div style={S.statCard}>
              <span style={S.statValue}>{teams.length}</span>
              <span style={S.statLabel}>Teams</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={S.emailTabBar}>
          <button
            style={{
              ...S.emailTab,
              ...(emailTab === 'inbox' && S.emailTabActive),
            }}
            onClick={() => setEmailTab('inbox')}
          >
            Inbox ({filteredEmails.length})
          </button>
          <button
            style={{
              ...S.emailTab,
              ...(emailTab === 'rules' && S.emailTabActive),
            }}
            onClick={() => setEmailTab('rules')}
          >
            Routing Rules ({routingRules.length})
          </button>
        </div>

        {emailTab === 'inbox' ? (
          <>
            {/* Filters */}
            <div style={S.emailFilterBar}>
              <select
                style={S.filterSelect}
                value={emailFilter.category}
                onChange={(e) => setEmailFilter({ ...emailFilter, category: e.target.value })}
              >
                <option value="">All Categories</option>
                {Object.keys(statsByCategory).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <select
                style={S.filterSelect}
                value={emailFilter.urgency}
                onChange={(e) => setEmailFilter({ ...emailFilter, urgency: e.target.value })}
              >
                <option value="">All Urgencies</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                style={S.filterSelect}
                value={emailFilter.team}
                onChange={(e) => setEmailFilter({ ...emailFilter, team: e.target.value })}
              >
                <option value="">All Teams</option>
                {teams.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
              <select
                style={S.filterSelect}
                value={emailFilter.status}
                onChange={(e) => setEmailFilter({ ...emailFilter, status: e.target.value })}
              >
                <option value="">All Status</option>
                <option value="new">New</option>
                <option value="assigned">Assigned</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>

            {/* Email list */}
            <div style={S.emailList}>
              {filteredEmails.length === 0 ? (
                <div style={S.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="m22 7-10 5L2 7"/>
                  </svg>
                  <div>No emails match current filters</div>
                </div>
              ) : (
                filteredEmails.map((email) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    isExpanded={expandedEmail === email.id}
                    onToggle={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {/* Routing Rules */}
            <button
              style={S.createRuleBtn}
              onClick={() => setShowCreateRule(!showCreateRule)}
            >
              <span style={{ fontSize: 18, marginRight: 8 }}>+</span> Create Rule
            </button>

            {showCreateRule && (
              <CreateRuleForm
                teams={teams}
                onClose={() => setShowCreateRule(false)}
                backendUrl={backendUrl}
                onCreated={fetchAll}
              />
            )}

            <div style={S.rulesList}>
              {routingRules.length === 0 ? (
                <div style={S.emptyState}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.3, marginBottom: 8 }}>
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  <div>No routing rules yet</div>
                </div>
              ) : (
                routingRules.map(rule => (
                  <RoutingRuleCard key={rule.id} rule={rule} />
                ))
              )}
            </div>
          </>
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

// ── Component: KPI Card ────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)
  const [isHovered, setIsHovered] = useState(false)
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
      <div style={S.kpiValue}>{value}</div>
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
          <div style={S.columnEmpty}>No tasks yet</div>
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
    <div style={{ ...S.taskCard, ...(isOverdue && S.taskCardOverdue) }}>
      <div style={{ ...S.taskCardBorder, background: priorityColor }} />
      <div style={S.taskCardContent} onClick={onClick}>
        <div style={S.taskTitle}>{task.title}</div>
        {task.assignee && (
          <div style={S.taskAssignee}>{task.assignee}</div>
        )}
        {task.due_date && (
          <div style={{
            ...S.taskDueDate,
            color: isOverdue ? T.danger : T.textMuted,
          }}>
            {new Date(task.due_date).toLocaleDateString()}
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

  // Utility
  staggerDelay: (index) => ({
    animationDelay: `${index * 50}ms`,
  }),
})
