/**
 * DashboardView.jsx — View Router for Astra OS
 * Routes activeView to the appropriate view component.
 * Data fetching is handled by the useBrainData hook.
 */
import { useEffect } from 'react'
import { useBrainData } from '../hooks/useBrainData'
import DashboardHome from './views/DashboardHome'
import EmailView from './views/EmailView'
import CRMView from './views/CRMView'
import TasksView from './views/TasksView'
import CalendarView from './views/CalendarView'
import BrainView from './views/BrainView'

export default function DashboardView({ activeView, backendUrl, transcript, config }) {
  const data = useBrainData(backendUrl, activeView)

  // Inject global animation styles once
  useEffect(() => {
    const styleId = 'astra-global-animations'
    if (document.getElementById(styleId)) return
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideInRight { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes slideInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 4px rgba(6,182,212,0.2); } 50% { box-shadow: 0 0 12px rgba(6,182,212,0.4); } }
      @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      @keyframes breathe { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
      @keyframes pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,0.7); } 50% { opacity: 0.8; box-shadow: 0 0 0 8px rgba(239,68,68,0); } }
      .stagger-1 { animation: fadeInUp 0.5s cubic-bezier(0.4,0,0.2,1) 0.05s both; }
      .stagger-2 { animation: fadeInUp 0.5s cubic-bezier(0.4,0,0.2,1) 0.1s both; }
      .stagger-3 { animation: fadeInUp 0.5s cubic-bezier(0.4,0,0.2,1) 0.15s both; }
      .stagger-4 { animation: fadeInUp 0.5s cubic-bezier(0.4,0,0.2,1) 0.2s both; }
      .stagger-5 { animation: fadeInUp 0.5s cubic-bezier(0.4,0,0.2,1) 0.25s both; }
      .astra-email-row:hover { background: rgba(255,255,255,0.03) !important; }
      .astra-split-btn:hover { background: rgba(255,255,255,0.05) !important; }
      .astra-action-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
      .astra-search-input:focus { border-color: #06b6d4 !important; box-shadow: 0 0 20px rgba(6,182,212,0.15) !important; }
      .astra-skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; }
      .astra-scroll::-webkit-scrollbar { width: 6px; }
      .astra-scroll::-webkit-scrollbar-track { background: transparent; }
      .astra-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
      .astra-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      @media (max-width: 1100px) { .astra-split-rail { display: none !important; } .astra-email-list { flex: 0 0 280px !important; } }
      @media (max-width: 900px) { .astra-email-list { flex: 0 0 240px !important; } }
      @media (max-width: 700px) { .astra-email-list { flex: 1 !important; } .astra-detail-panel { display: none !important; } }
    `
    document.head.appendChild(style)
    return () => { const el = document.getElementById(styleId); if (el) el.remove() }
  }, [])

  switch (activeView) {
    case 'dashboard':
      return <DashboardHome data={data} />
    case 'email':
      return <EmailView data={data} backendUrl={backendUrl} />
    case 'crm':
      return <CRMView data={data} />
    case 'tasks':
      return <TasksView data={data} backendUrl={backendUrl} />
    case 'calendar':
      return <CalendarView data={data} />
    case 'brain':
      return <BrainView data={data} />
    default:
      return <DashboardHome data={data} />
  }
}
