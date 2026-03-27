/**
 * EmailView.jsx — Email Intelligence with Split Inbox, RAG Search, Pipeline, Contacts, Briefing
 * Extracted from DashboardView.jsx. Full Superhuman-style email client.
 */
import { useState, useCallback } from 'react'
import { useTheme } from '../../ThemeContext'
import { getPriorityColor, getPriorityBg, relativeTime, sortByTime } from '../../utils/helpers'
import { SearchIcon, ExternalLinkIcon, BoltIcon, ChatIcon } from '../shared/Icons'

export default function EmailView({ data, backendUrl }) {
  const { theme: T } = useTheme()
  const {
    scoredEmails, setScoredEmails, pipelineSummary, scannerHealth,
    contactTiers, emailBriefing, fetchAll,
  } = data

  // Local state
  const [scanning, setScanning] = useState(false)
  const [emailDetailId, setEmailDetailId] = useState(null)
  const [emailDetail, setEmailDetail] = useState(null)
  const [emailIntelTab, setEmailIntelTab] = useState('splits')
  const [emailPriorityFilter, setEmailPriorityFilter] = useState('')
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
  const [showEmailBody, setShowEmailBody] = useState(false)

  const priorityColor = (p) => getPriorityColor(p, T)
  const priorityBg = (p) => getPriorityBg(p, T)

  // Split tab config
  const splitTabs = [
    { id: 'all', label: 'All Mail', color: T.accentCyan, icon: '\u2709' },
    { id: 'action_required', label: 'Action', color: T.danger, icon: '!' },
    { id: 'vip', label: 'VIP', color: '#3b82f6', icon: '\u2605' },
    { id: 'team', label: 'Team', color: T.accentPurple, icon: '\u2302' },
    { id: 'updates', label: 'Updates', color: T.textMuted, icon: '\u2709' },
    { id: 'newsletters', label: 'News', color: 'rgba(107,114,128,0.6)', icon: '\u2611' },
    { id: 'other', label: 'Other', color: T.textDim, icon: '\u2026' },
    { id: 'done', label: 'Done', color: T.success, icon: '\u2713' },
  ]

  const currentSplitEmails = sortByTime(activeSplit === 'all' ? scoredEmails : (splitData?.splits?.[activeSplit] || []))
  const splitCounts = { ...(splitData?.counts || {}), all: scoredEmails.length }
  const filteredScored = sortByTime(scoredEmails.filter(e => {
    if (emailPriorityFilter && e.priority !== emailPriorityFilter) return false
    return true
  }))

  const triggerScan = async () => {
    setScanning(true)
    try {
      await fetch(`${backendUrl}/brain/emails/intelligence-scan`, { method: 'POST' })
      await fetch(`${backendUrl}/brain/emails/reclassify`, { method: 'POST' }).catch(() => {})
      const splitRes = await fetch(`${backendUrl}/brain/emails/splits`)
      if (splitRes.ok) setSplitData(await splitRes.json())
      await fetchAll()
    } catch (e) { console.error('Scan failed:', e) }
    setScanning(false)
  }

  const moveStage = async (emailId, newStage) => {
    try {
      await fetch(`${backendUrl}/brain/emails/${emailId}/stage`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: email.sender_email, recipient_name: email.sender,
          thread_subject: email.subject, thread_body: email.snippet || '', instruction: '',
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours_back: 720 })
      })
      setEmbedStats(await res.json())
    } catch (e) { console.error('Sync failed:', e) }
    setSyncing(false)
  }

  // Fetch splits on mount if needed
  if (!splitData && scoredEmails.length > 0) {
    fetch(`${backendUrl}/brain/emails/splits`).then(r => r.ok ? r.json() : null).then(d => { if (d) setSplitData(d) }).catch(() => {})
  }

  // Keyboard shortcuts
  const handleKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
    const emails = currentSplitEmails.length > 0 ? currentSplitEmails : filteredScored
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(selectedEmailIdx + 1, emails.length - 1)
      setSelectedEmailIdx(next)
      if (emails[next]) loadDetail(emails[next].message_id)
      setDraftResult(null)
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = Math.max(selectedEmailIdx - 1, 0)
      setSelectedEmailIdx(prev)
      if (emails[prev]) loadDetail(emails[prev].message_id)
      setDraftResult(null)
    } else if (e.key === 'r' && emailDetail) {
      e.preventDefault()
      if (emails[selectedEmailIdx]) handleDraft(emails[selectedEmailIdx])
    } else if (e.key === 'a' && emailDetail) {
      e.preventDefault()
      moveStage(emailDetail.message_id || emailDetailId, 'archived')
    } else if (e.key === 'e' && emailDetail) {
      e.preventDefault()
      setShowEmailBody(prev => !prev)
    } else if (e.key === 'Escape') {
      setEmailDetailId(null); setEmailDetail(null); setShowEmailBody(false)
    }
  }

  return (
    <div tabIndex={0} onKeyDown={handleKeyDown} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg, overflow: 'hidden', outline: 'none' }} role="main" aria-label="Email Intelligence">
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.bgElevated }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(139,92,246,0.15))', border: '1px solid rgba(6,182,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.accentCyan} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
          </div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: T.text, letterSpacing: '-0.02em' }}>Inbox</h1>
            <span style={{ fontSize: 10, color: T.textDim, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', animation: 'breathe 2s ease-in-out infinite', flexShrink: 0 }} />
              Live sync · {scoredEmails.length} emails tracked
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {scannerHealth && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`, fontSize: 10, color: T.textSecondary, fontWeight: 500 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: scannerHealth.status === 'healthy' ? T.success : T.warning, animation: 'breathe 2s ease-in-out infinite' }} />
              {scannerHealth.status || 'unknown'}
            </div>
          )}
          {embedStats && (
            <div style={{ fontSize: 10, color: T.textMuted, padding: '6px 12px', borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {(embedStats.indexed || 0).toLocaleString()} indexed
            </div>
          )}
          <button onClick={handleEmbedSync} disabled={syncing} className="astra-action-btn" style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(139,92,246,0.12)', color: T.accentPurple, border: `1px solid rgba(139,92,246,0.25)`, fontSize: 11, fontWeight: 600, transition: 'all 0.2s', opacity: syncing ? 0.5 : 1 }}>
            {syncing ? 'Syncing...' : 'Sync Memory'}
          </button>
          <button onClick={triggerScan} disabled={scanning} className="astra-action-btn" style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`, color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, transition: 'all 0.2s', opacity: scanning ? 0.5 : 1, boxShadow: scanning ? 'none' : T.shadowGlow }}>
            {scanning ? 'Scanning...' : 'Scan Inbox'}
          </button>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div style={{ padding: '14px 24px', flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.bgElevated }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.textMuted }}><SearchIcon /></div>
            <input type="text" className="astra-search-input" placeholder="Search or ask anything..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ width: '100%', padding: '11px 16px 11px 40px', borderRadius: 10, background: T.bgInput, border: `1px solid ${T.border}`, color: T.text, fontSize: 12, outline: 'none', transition: 'all 0.25s ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)' }} aria-label="Search emails" />
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 8, fontWeight: 700, color: T.textDim, pointerEvents: 'none', background: T.bgSurface, padding: '2px 6px', borderRadius: 4 }}>AI</span>
          </div>
          <button onClick={handleSearch} disabled={searching} className="astra-action-btn" style={{ padding: '11px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`, color: '#fff', fontSize: 12, fontWeight: 700, opacity: searching ? 0.6 : 1, transition: 'all 0.2s' }}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
        {searchResults && (
          <div style={{ marginTop: 10, padding: 14, borderRadius: 10, background: T.bgCard, border: `1px solid ${T.borderAccent}`, animation: 'slideInUp 0.25s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{searchResults.results?.length || 0} results</span>
              <button onClick={() => setSearchResults(null)} style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 }}>×</button>
            </div>
            {searchResults.answer && (
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.65, marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: T.bgSurface, borderLeft: `3px solid ${T.accentCyan}`, fontWeight: 500 }}>{searchResults.answer}</div>
            )}
            {(searchResults.results || []).slice(0, 5).map((r, i) => (
              <div key={i} style={{ padding: '8px 10px', marginBottom: 4, borderRadius: 6, background: T.bgSurface, fontSize: 11, display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, background: 'rgba(6,182,212,0.1)', padding: '2px 6px', borderRadius: 4, flexShrink: 0, alignSelf: 'flex-start' }}>{((r.relevance_score || 0) * 100).toFixed(0)}%</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: T.text, marginBottom: 1 }}>{r.sender || 'Unknown'} — {r.subject || 'No subject'}</div>
                  <div style={{ fontSize: 10, color: T.textMuted, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.chunk_text || '').slice(0, 200)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TAB BAR */}
      <div style={{ display: 'flex', gap: 0, padding: '0 24px', flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.bgElevated }}>
        {[
          { id: 'splits', label: 'Split Inbox', count: scoredEmails.length },
          { id: 'pipeline', label: 'Pipeline', count: pipelineSummary?.total || 0 },
          { id: 'contacts', label: 'Contacts', count: contactTiers ? Object.keys(contactTiers.tier_1 || {}).length + Object.keys(contactTiers.tier_2 || {}).length : 0 },
          { id: 'briefing', label: 'Briefing', count: emailBriefing?.action_items?.length || 0 },
        ].map(tab => (
          <button key={tab.id} onClick={() => setEmailIntelTab(tab.id)} style={{ padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: emailIntelTab === tab.id ? 700 : 500, color: emailIntelTab === tab.id ? T.text : T.textMuted, transition: 'all 0.25s', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `3px solid ${emailIntelTab === tab.id ? T.accentCyan : 'transparent'}` }} role="tab" aria-selected={emailIntelTab === tab.id}>
            {tab.label}
            {tab.count > 0 && <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: emailIntelTab === tab.id ? `${T.accentCyan}20` : T.bgSurface, color: emailIntelTab === tab.id ? T.accentCyan : T.textDim, fontVariantNumeric: 'tabular-nums', lineHeight: '12px' }}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* SPLITS TAB */}
        {emailIntelTab === 'splits' && (
          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* SPLIT RAIL */}
            <div className="astra-split-rail" style={{ flex: '0 0 150px', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.border}`, background: T.bgPanel, padding: '10px 6px' }}>
              {splitTabs.map((st) => {
                const isActive = activeSplit === st.id
                const count = splitCounts[st.id] || 0
                return (
                  <button key={st.id} onClick={() => { setActiveSplit(st.id); setSelectedEmailIdx(0); setDraftResult(null) }} className="astra-split-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: isActive ? 700 : 500, background: isActive ? `${st.color}20` : 'transparent', color: isActive ? st.color : T.textMuted, transition: 'all 0.15s ease', marginBottom: 4 }}>
                    <span style={{ fontSize: 14, lineHeight: 1, width: 16, textAlign: 'center' }}>{st.icon}</span>
                    <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{st.label}</span>
                    {count > 0 && <span style={{ fontSize: 8, fontWeight: 800, minWidth: 20, textAlign: 'center', background: isActive ? st.color : T.bgSurface, color: isActive ? '#000' : T.textDim, padding: '2px 6px', borderRadius: 6, lineHeight: '14px', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
                  </button>
                )
              })}
              <div style={{ height: 1, background: T.border, margin: '8px 0' }} />
              <div style={{ marginTop: 'auto', padding: '8px 0' }}>
                <select value={emailPriorityFilter} onChange={e => setEmailPriorityFilter(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, background: T.bgInput, border: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 10, outline: 'none', cursor: 'pointer', fontWeight: 500 }} aria-label="Filter by priority">
                  <option value="">All priorities</option>
                  <option value="critical">Critical</option><option value="urgent">Urgent</option><option value="important">Important</option><option value="notable">Notable</option><option value="low">Low</option>
                </select>
              </div>
            </div>

            {/* EMAIL LIST */}
            <div className="astra-email-list" style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.border}`, background: T.bgCard, minHeight: 0 }}>
              {(() => {
                const emails = currentSplitEmails.length > 0 ? currentSplitEmails : filteredScored
                if (emails.length === 0) {
                  return (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
                      {scanning ? (
                        <><div className="astra-skeleton" style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 16 }} /><div className="astra-skeleton" style={{ width: 160, height: 12, borderRadius: 6, marginBottom: 8 }} /><div className="astra-skeleton" style={{ width: 120, height: 10, borderRadius: 6 }} /></>
                      ) : (
                        <><div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No emails here yet</div><div style={{ fontSize: 11, color: T.textDim }}>Click "Scan Inbox" to score and categorize your emails</div></>
                      )}
                    </div>
                  )
                }
                return (
                  <>
                    <div className="astra-scroll" style={{ flex: 1, overflowY: 'auto' }}>
                      {emails.map((email, idx) => {
                        const isSelected = selectedEmailIdx === idx
                        const isUnread = !email.is_read
                        return (
                          <div key={email.message_id || idx} onClick={() => { setSelectedEmailIdx(idx); loadDetail(email.message_id); setDraftResult(null) }} className={isSelected ? '' : 'astra-email-row'} style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: `1px solid ${T.borderSubtle}`, background: isSelected ? `${T.accentCyan}0a` : 'transparent', borderLeft: `3px solid ${isSelected ? T.accentCyan : priorityColor(email.priority)}`, transition: 'all 0.12s ease' }} role="option" aria-selected={isSelected}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                              <span style={{ fontSize: 13, fontWeight: isUnread ? 700 : 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{email.sender || email.sender_email || 'Unknown'}</span>
                              {isUnread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.accentCyan, flexShrink: 0, marginLeft: 6, marginRight: 6, boxShadow: `0 0 4px ${T.accentCyan}` }} />}
                              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 500, flexShrink: 0, marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>{relativeTime(email.date)}</span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{email.subject || '(no subject)'}</div>
                            {(email.briefing || email.snippet) && <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5 }}>{email.briefing || email.snippet}</div>}
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              {email.category && email.category !== 'unknown' && (
                                <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: email.category === 'investor' ? 'rgba(59,130,246,0.12)' : email.category === 'customer' ? 'rgba(16,185,129,0.12)' : email.category === 'internal' ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.08)', color: email.category === 'investor' ? '#3b82f6' : email.category === 'customer' ? '#10b981' : email.category === 'internal' ? T.accentPurple : T.accentPurple, letterSpacing: '0.02em' }}>{email.category}</span>
                              )}
                              {email.score >= 7 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{email.score}/10</span>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ padding: '10px 14px', fontSize: 10, color: T.textDim, flexShrink: 0, borderTop: `1px solid ${T.border}`, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {emails.length} email{emails.length !== 1 ? 's' : ''}{emailPriorityFilter && ` · ${emailPriorityFilter}`}
                    </div>
                  </>
                )
              })()}
            </div>

            {/* DETAIL PANEL */}
            <div className="astra-detail-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: T.bg, overflow: 'hidden' }}>
              {emailDetail ? (
                <div className="astra-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', animation: 'slideInRight 0.2s ease' }}>
                  {/* Header */}
                  <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${T.border}`, background: T.bgElevated }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0, lineHeight: 1.35, flex: 1 }}>{emailDetail.subject || '(no subject)'}</h2>
                      {emailDetail.message_id && (
                        <a href={`https://mail.google.com/mail/u/0/#inbox/${emailDetail.message_id}`} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSecondary, fontSize: 10, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <ExternalLinkIcon /> Open in Gmail
                        </a>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff' }}>
                        {((emailDetail.sender || 'U')[0] || 'U').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{emailDetail.sender || 'Unknown'}</div>
                        <div style={{ fontSize: 10, color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emailDetail.sender_email || ''}</div>
                      </div>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding: '16px 20px' }}>
                    {/* Priority badges */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: `linear-gradient(135deg, ${priorityColor(emailDetail.priority || 'low')}, ${T.accentPurple})`, padding: '5px 12px', borderRadius: 6 }}>{emailDetail.score || 0}/10</div>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '6px 10px', borderRadius: 5, background: priorityBg(emailDetail.priority || 'low'), color: priorityColor(emailDetail.priority || 'low'), textTransform: 'uppercase', letterSpacing: '0.04em' }}>{emailDetail.priority || 'unknown'}</span>
                      {emailDetail.category && emailDetail.category !== 'unknown' && <span style={{ fontSize: 9, fontWeight: 700, padding: '6px 10px', borderRadius: 5, background: 'rgba(139,92,246,0.1)', color: T.accentPurple, textTransform: 'uppercase' }}>{emailDetail.category}</span>}
                    </div>

                    {/* Recommended Action */}
                    {emailDetail.recommended_action && emailDetail.recommended_action !== 'none' && (
                      <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: emailDetail.recommended_action === 'respond_now' ? 'rgba(239,68,68,0.08)' : emailDetail.recommended_action === 'review_today' ? 'rgba(245,158,11,0.08)' : 'rgba(6,182,212,0.06)', border: `1px solid ${emailDetail.recommended_action === 'respond_now' ? 'rgba(239,68,68,0.2)' : emailDetail.recommended_action === 'review_today' ? 'rgba(245,158,11,0.2)' : 'rgba(6,182,212,0.15)'}` }}>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, color: emailDetail.recommended_action === 'respond_now' ? '#ef4444' : emailDetail.recommended_action === 'review_today' ? '#f59e0b' : T.accentCyan }}>Recommended Action</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, textTransform: 'capitalize' }}>{(emailDetail.recommended_action || '').replace(/_/g, ' ')}</div>
                      </div>
                    )}

                    {/* AI Briefing */}
                    {emailDetail.briefing && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}><BoltIcon color={T.accentCyan} /> AI Briefing</div>
                        <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55, padding: '12px 14px', borderRadius: 8, background: 'rgba(6,182,212,0.05)', border: `1px solid rgba(6,182,212,0.12)`, borderLeft: `3px solid ${T.accentCyan}` }}>{emailDetail.briefing}</div>
                      </div>
                    )}

                    {/* Strategic Context */}
                    {emailDetail.strategic_context && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.06em' }}>Strategic Context</div>
                        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.55, padding: '12px 14px', borderRadius: 8, background: 'rgba(139,92,246,0.04)', border: `1px solid rgba(139,92,246,0.1)`, borderLeft: `3px solid ${T.accentPurple}` }}>{emailDetail.strategic_context}</div>
                      </div>
                    )}

                    {/* Suggested Reply */}
                    {emailDetail.draft_reply && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.success, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}><ChatIcon color={T.success} /> Suggested Reply</div>
                        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.05)', border: `1px solid rgba(34,197,94,0.1)`, borderLeft: `3px solid ${T.success}`, fontSize: 12, color: T.text, lineHeight: 1.55 }}>{emailDetail.draft_reply}</div>
                        <button onClick={() => navigator.clipboard.writeText(emailDetail.draft_reply)} style={{ marginTop: 6, padding: '5px 10px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSecondary, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Copy Reply</button>
                      </div>
                    )}

                    {/* Voice Draft */}
                    {draftResult && (
                      <div style={{ marginBottom: 14, animation: 'slideInUp 0.2s ease' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.06em' }}>Voice Draft</div>
                        <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(139,92,246,0.04)', border: `1px solid rgba(139,92,246,0.1)`, borderLeft: `3px solid ${T.accentPurple}`, fontSize: 12, color: T.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{draftResult.draft || 'No draft generated.'}</div>
                        <button onClick={() => navigator.clipboard.writeText(draftResult.draft || '')} style={{ marginTop: 6, padding: '5px 10px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSecondary, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Copy Draft</button>
                      </div>
                    )}

                    {/* Email Body Toggle */}
                    {emailDetail.body && (
                      <div style={{ marginBottom: 14 }}>
                        <button onClick={() => setShowEmailBody(prev => !prev)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSecondary, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                          {showEmailBody ? 'Hide' : 'Show'} Original Email
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: T.textDim, opacity: 0.6 }}>E</span>
                        </button>
                        {showEmailBody && (
                          <div className="astra-scroll" style={{ marginTop: 8, padding: 14, borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`, fontSize: 12, color: T.textSecondary, lineHeight: 1.6, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>
                            {emailDetail.body.substring(0, 3000)}{emailDetail.body.length > 3000 && '\n\n... (truncated)'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Keyboard hints */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
                      {[{ key: 'J/K', label: 'Navigate' }, { key: 'R', label: 'Reply' }, { key: 'A', label: 'Archive' }, { key: 'E', label: 'Body' }, { key: 'Esc', label: 'Close' }].map(h => (
                        <span key={h.key} style={{ fontSize: 9, color: T.textDim, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ padding: '1px 5px', borderRadius: 3, border: `1px solid ${T.border}`, fontFamily: 'ui-monospace, monospace', fontSize: 8, fontWeight: 600, background: 'rgba(255,255,255,0.03)' }}>{h.key}</span>{h.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action bar */}
                  <div style={{ padding: '12px 20px 16px', borderTop: `1px solid ${T.border}`, background: T.bgElevated, position: 'sticky', bottom: 0 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                      {['triaged', 'action_required', 'delegated', 'scheduled', 'replied', 'done'].map(stage => {
                        const isCurrentStage = (emailDetail.pipeline_stage || 'triaged') === stage
                        const stageColors = { triaged: T.accentCyan, action_required: '#ef4444', delegated: '#f59e0b', scheduled: '#8b5cf6', replied: '#3b82f6', done: '#22c55e' }
                        return (
                          <button key={stage} onClick={() => moveStage(emailDetail.message_id || emailDetailId, stage)} style={{ padding: '5px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: isCurrentStage ? 700 : 500, background: isCurrentStage ? `${stageColors[stage]}20` : 'rgba(255,255,255,0.03)', color: isCurrentStage ? stageColors[stage] : T.textDim, textTransform: 'capitalize', outline: isCurrentStage ? `1px solid ${stageColors[stage]}40` : 'none' }}>
                            {stage.replace(/_/g, ' ')}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => { const emails = currentSplitEmails.length > 0 ? currentSplitEmails : filteredScored; if (emails[selectedEmailIdx]) handleDraft(emails[selectedEmailIdx]) }} disabled={drafting} className="astra-action-btn" style={{ flex: 1, padding: '10px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', background: `linear-gradient(135deg, ${T.accentCyan}, ${T.accentPurple})`, color: '#fff', fontSize: 11, fontWeight: 700, opacity: drafting ? 0.6 : 1 }}>
                        {drafting ? 'Generating...' : 'Draft Reply'}
                      </button>
                      <button onClick={() => moveStage(emailDetail.message_id || emailDetailId, 'archived')} className="astra-action-btn" style={{ padding: '10px 14px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Archive</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(6,182,212,0.06)', border: `1px solid rgba(6,182,212,0.1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={T.textDim} strokeWidth="1.5" style={{ opacity: 0.4 }}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                  </div>
                  <div style={{ fontSize: 14, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>Select an email</div>
                  <div style={{ fontSize: 11, color: T.textDim, maxWidth: 200 }}>Choose from the list to view AI analysis and take action</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PIPELINE TAB */}
        {emailIntelTab === 'pipeline' && (
          <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            {pipelineSummary ? (
              <div style={{ animation: 'fadeIn 0.3s ease' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                  <div style={{ padding: 14, borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>By Priority</div>
                    {Object.entries(pipelineSummary.by_priority || {}).map(([p, count]) => (
                      <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: priorityColor(p) }} />
                        <span style={{ fontSize: 11, color: T.text, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>{p}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: priorityColor(p), fontVariantNumeric: 'tabular-nums' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 14, borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.accentPurple, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>By Stage</div>
                    {Object.entries(pipelineSummary.by_stage || {}).map(([s, count]) => (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: s === 'action_required' ? T.danger : s === 'done' ? T.success : T.accentCyan, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: T.text, fontWeight: 600, flex: 1, textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: T.textSecondary }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No pipeline data</div>
                <div style={{ fontSize: 11, color: T.textDim }}>Run a scan to populate</div>
              </div>
            )}
          </div>
        )}

        {/* CONTACTS TAB */}
        {emailIntelTab === 'contacts' && (
          <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            {contactTiers ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                {[{ label: 'VIP', tier: 'tier_1', color: T.danger }, { label: 'Active', tier: 'tier_2', color: T.accentCyan }, { label: 'Other', tier: 'tier_3', color: T.textMuted }].map(({ label, tier, color }) => (
                  <div key={tier} style={{ padding: 14, borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Tier — {label} <span style={{ color: T.textDim }}>({Object.keys(contactTiers[tier] || {}).length})</span></div>
                    {Object.entries(contactTiers[tier] || {}).map(([email, name]) => (
                      <div key={email} style={{ padding: '6px 8px', borderRadius: 6, background: T.bgSurface, marginBottom: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{name || email}</div>
                        <div style={{ fontSize: 9, color: T.textMuted }}>{email}</div>
                      </div>
                    ))}
                    {Object.keys(contactTiers[tier] || {}).length === 0 && <div style={{ fontSize: 10, color: T.textDim, padding: 8 }}>None</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>No contact data</div>
                <div style={{ fontSize: 11, color: T.textDim }}>Run a scan to initialize contacts</div>
              </div>
            )}
          </div>
        )}

        {/* BRIEFING TAB */}
        {emailIntelTab === 'briefing' && (
          <div className="astra-scroll" style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
            {emailBriefing ? (
              <div style={{ animation: 'fadeIn 0.3s ease' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 18 }}>
                  {[{ label: 'Recent', value: emailBriefing.summary?.total_recent || 0, color: T.accentCyan }, { label: 'Critical', value: emailBriefing.summary?.critical || 0, color: T.danger }, { label: 'Urgent', value: emailBriefing.summary?.urgent || 0, color: T.warning }, { label: 'Unread', value: emailBriefing.summary?.unread || 0, color: T.accentPurple }].map(({ label, value, color }) => (
                    <div key={label} style={{ padding: '10px 12px', borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                      <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                    </div>
                  ))}
                </div>
                {emailBriefing.voice_briefing && (
                  <div style={{ padding: 14, borderRadius: 10, marginBottom: 18, background: T.bgCard, borderLeft: `3px solid ${T.accentCyan}`, border: `1px solid ${T.borderAccent}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.accentCyan, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.06em' }}>Voice Briefing</div>
                    <p style={{ fontSize: 12, color: T.text, lineHeight: 1.65, margin: 0 }}>{emailBriefing.voice_briefing}</p>
                  </div>
                )}
                {(emailBriefing.action_items || []).length > 0 && (
                  <div style={{ padding: 14, borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.danger, textTransform: 'uppercase', marginBottom: 10, letterSpacing: '0.06em' }}>Action Items ({emailBriefing.action_items.length})</div>
                    {emailBriefing.action_items.map((item, i) => (
                      <div key={i} style={{ padding: '8px 10px', borderRadius: 6, marginBottom: 6, background: T.bgSurface, borderLeft: `3px solid ${priorityColor(item.priority || 'low')}`, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: priorityColor(item.priority || 'low'), marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 2 }}>{item.sender || 'Unknown'} — {item.subject || 'No subject'}</div>
                          <div style={{ fontSize: 10, color: T.textMuted }}>{item.briefing || (item.action ? `Action: ${item.action}` : '')}</div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: priorityColor(item.priority || 'low') }}>{item.score || 0}</div>
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

      {/* KPI BAR */}
      {pipelineSummary && (
        <div style={{ display: 'flex', gap: 12, padding: '14px 24px', flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bgElevated }}>
          {[{ label: 'Critical', value: pipelineSummary.by_priority?.critical || 0, color: T.danger }, { label: 'Urgent', value: pipelineSummary.by_priority?.urgent || 0, color: T.warning }, { label: 'Total', value: pipelineSummary.total || 0, color: T.accentCyan }, { label: 'Action', value: pipelineSummary.action_required || 0, color: '#3b82f6' }].map(kpi => (
            <div key={kpi.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, background: T.bgCard, border: `1px solid ${T.border}`, flex: 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: kpi.color, flexShrink: 0, boxShadow: kpi.value > 0 ? `0 0 8px ${kpi.color}40` : 'none' }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: kpi.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{kpi.value}</span>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, whiteSpace: 'nowrap' }}>{kpi.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
