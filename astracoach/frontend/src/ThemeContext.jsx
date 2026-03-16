/**
 * ThemeContext.jsx — Astra OS Theme System
 * =========================================
 * Provides light/dark theme switching with a complete color palette.
 * Components consume theme via useTheme() hook.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext(null)

// ── Dark Theme ──────────────────────────────────────────────────────────────
const dark = {
  name: 'dark',
  // Backgrounds
  bg:             '#07070f',
  bgElevated:     '#0c0c18',
  bgCard:         'rgba(14, 14, 28, 0.55)',
  bgCardHover:    'rgba(20, 20, 38, 0.65)',
  bgGlass:        'rgba(16, 16, 32, 0.45)',
  bgGlassHeavy:   'rgba(12, 12, 24, 0.7)',
  bgSurface:      'rgba(255,255,255,0.03)',
  bgInput:        'rgba(255,255,255,0.04)',
  bgInputFocus:   'rgba(255,255,255,0.06)',
  bgPanel:        '#0a0a14',
  bgSidebar:      'rgba(14, 14, 28, 0.6)',
  bgTopBar:       'rgba(14, 14, 28, 0.5)',
  bgVoiceBar:     'rgba(14, 14, 28, 0.6)',
  bgOverlay:      'rgba(7,7,15,0.92)',
  bgStartCard:    'rgba(14,14,28,0.5)',

  // Text
  text:           '#eef0fa',
  textSecondary:  'rgba(238,240,250,0.6)',
  textDim:        'rgba(238,240,250,0.45)',
  textMuted:      'rgba(238,240,250,0.3)',

  // Borders
  border:         'rgba(255,255,255,0.08)',
  borderSubtle:   'rgba(255,255,255,0.05)',
  borderAccent:   'rgba(79,125,255,0.2)',
  borderGlow:     'rgba(79,125,255,0.35)',

  // Accents
  accent:         '#4f7dff',
  accentCyan:     '#06b6d4',
  accentPurple:   '#8b5cf6',
  accentSoft:     'rgba(79,125,255,0.12)',
  accentGlow:     'rgba(79,125,255,0.25)',

  // Semantic
  success:        '#22c55e',
  successSoft:    'rgba(34,197,94,0.12)',
  warning:        '#f59e0b',
  warningSoft:    'rgba(245,158,11,0.12)',
  danger:         '#ef4444',
  dangerSoft:     'rgba(239,68,68,0.12)',

  // Gradients
  gradientPrimary: 'linear-gradient(135deg, #4f7dff 0%, #7c3aed 50%, #06b6d4 100%)',
  gradientSubtle:  'linear-gradient(135deg, rgba(79,125,255,0.08), rgba(124,58,237,0.05))',
  gradientBg:      'radial-gradient(ellipse at 50% 40%, rgba(20,20,35,1) 0%, #0a0a14 70%)',
  gradientFade:    'linear-gradient(transparent, rgba(10,10,20,0.85))',

  // Shadows
  shadowSm:       '0 2px 8px rgba(0,0,0,0.3)',
  shadowMd:       '0 4px 16px rgba(0,0,0,0.4)',
  shadowLg:       '0 8px 32px rgba(0,0,0,0.5)',
  shadowGlow:     '0 0 20px rgba(79,125,255,0.15)',
  shadowFloat:    '0 12px 40px rgba(0,0,0,0.6)',

  // Component-specific
  pipCamBg:       '#0a0a14',
  pipCamBorder:   'rgba(255,255,255,0.15)',
  transcriptBg:   'rgba(14,14,26,0.7)',
  transcriptModel: 'rgba(79,125,255,0.06)',
  transcriptModelBorder: 'rgba(79,125,255,0.1)',
  transcriptUser:  'rgba(34,197,94,0.06)',
  transcriptUserBorder:  'rgba(34,197,94,0.1)',
  modelColor:     '#93c5fd',
  userColor:      '#86efac',

  // Sidebar
  navActive:      'rgba(6,182,212,0.08)',
  navActiveBorder: '#06b6d4',
  navHover:       'rgba(255,255,255,0.04)',
  navText:        'rgba(238,240,250,0.45)',
  navActiveText:  '#06b6d4',

  // KPI
  kpiIconBg:      'linear-gradient(135deg, rgba(79,125,255,0.15), rgba(124,58,237,0.1))',
  alertHigh:      '#ef4444',
  alertMedium:    '#f59e0b',
  alertLow:       '#06b6d4',

  // Avatar backdrop
  avatarBackdropFilter: 'blur(60px) brightness(0.3) saturate(1.2)',
  avatarBackdropOpacity: 0.6,

  // Voice command feedback
  commandPillBg: 'rgba(79, 125, 255, 0.15)',
  commandPillBorder: 'rgba(79, 125, 255, 0.4)',

  // Live captions over avatar
  captionBg: 'rgba(0, 0, 0, 0.7)',
  captionText: '#ffffff',

  // Overdue task glow
  overduePulse: 'rgba(239, 68, 68, 0.3)',

  // Trend indicators
  trendUp: '#22c55e',
  trendDown: '#ef4444',
  trendNeutral: '#94a3b8',

  // Scrollbar
  scrollbarThumb: 'rgba(255,255,255,0.1)',
  scrollbarThumbHover: 'rgba(255,255,255,0.2)',
}

// ── Light Theme ─────────────────────────────────────────────────────────────
const light = {
  name: 'light',
  // Backgrounds
  bg:             '#f5f7fb',
  bgElevated:     '#ffffff',
  bgCard:         'rgba(255, 255, 255, 0.75)',
  bgCardHover:    'rgba(255, 255, 255, 0.9)',
  bgGlass:        'rgba(255, 255, 255, 0.55)',
  bgGlassHeavy:   'rgba(255, 255, 255, 0.75)',
  bgSurface:      'rgba(0,0,0,0.02)',
  bgInput:        'rgba(0,0,0,0.04)',
  bgInputFocus:   'rgba(0,0,0,0.06)',
  bgPanel:        '#f0f2f8',
  bgSidebar:      'rgba(255, 255, 255, 0.7)',
  bgTopBar:       'rgba(255, 255, 255, 0.65)',
  bgVoiceBar:     'rgba(255, 255, 255, 0.65)',
  bgOverlay:      'rgba(245,247,251,0.95)',
  bgStartCard:    'rgba(255,255,255,0.6)',

  // Text
  text:           '#1a1d2e',
  textSecondary:  'rgba(26,29,46,0.65)',
  textDim:        'rgba(26,29,46,0.5)',
  textMuted:      'rgba(26,29,46,0.35)',

  // Borders
  border:         'rgba(0,0,0,0.1)',
  borderSubtle:   'rgba(0,0,0,0.06)',
  borderAccent:   'rgba(79,125,255,0.3)',
  borderGlow:     'rgba(79,125,255,0.4)',

  // Accents
  accent:         '#3b6cf5',
  accentCyan:     '#0891b2',
  accentPurple:   '#7c3aed',
  accentSoft:     'rgba(59,108,245,0.1)',
  accentGlow:     'rgba(59,108,245,0.2)',

  // Semantic
  success:        '#16a34a',
  successSoft:    'rgba(22,163,74,0.1)',
  warning:        '#d97706',
  warningSoft:    'rgba(217,119,6,0.1)',
  danger:         '#dc2626',
  dangerSoft:     'rgba(220,38,38,0.1)',

  // Gradients
  gradientPrimary: 'linear-gradient(135deg, #3b6cf5 0%, #7c3aed 50%, #0891b2 100%)',
  gradientSubtle:  'linear-gradient(135deg, rgba(59,108,245,0.06), rgba(124,58,237,0.04))',
  gradientBg:      'radial-gradient(ellipse at 50% 40%, rgba(240,242,248,1) 0%, #f5f7fb 70%)',
  gradientFade:    'linear-gradient(transparent, rgba(240,242,248,0.9))',

  // Shadows
  shadowSm:       '0 1px 4px rgba(0,0,0,0.06)',
  shadowMd:       '0 2px 10px rgba(0,0,0,0.08)',
  shadowLg:       '0 4px 20px rgba(0,0,0,0.1)',
  shadowGlow:     '0 0 16px rgba(59,108,245,0.12)',
  shadowFloat:    '0 8px 30px rgba(0,0,0,0.12)',

  // Component-specific
  pipCamBg:       '#f0f2f8',
  pipCamBorder:   'rgba(0,0,0,0.12)',
  transcriptBg:   'rgba(255,255,255,0.6)',
  transcriptModel: 'rgba(59,108,245,0.06)',
  transcriptModelBorder: 'rgba(59,108,245,0.12)',
  transcriptUser:  'rgba(22,163,74,0.06)',
  transcriptUserBorder:  'rgba(22,163,74,0.12)',
  modelColor:     '#2563eb',
  userColor:      '#16a34a',

  // Sidebar
  navActive:      'rgba(8,145,178,0.08)',
  navActiveBorder: '#0891b2',
  navHover:       'rgba(0,0,0,0.04)',
  navText:        'rgba(26,29,46,0.5)',
  navActiveText:  '#0891b2',

  // KPI
  kpiIconBg:      'linear-gradient(135deg, rgba(59,108,245,0.1), rgba(124,58,237,0.06))',
  alertHigh:      '#dc2626',
  alertMedium:    '#d97706',
  alertLow:       '#0891b2',

  // Avatar backdrop
  avatarBackdropFilter: 'blur(60px) brightness(0.8) saturate(0.8)',
  avatarBackdropOpacity: 0.35,

  // Voice command feedback
  commandPillBg: 'rgba(59, 108, 245, 0.12)',
  commandPillBorder: 'rgba(59, 108, 245, 0.3)',

  // Live captions over avatar
  captionBg: 'rgba(26, 29, 46, 0.85)',
  captionText: '#ffffff',

  // Overdue task glow
  overduePulse: 'rgba(220, 38, 38, 0.25)',

  // Trend indicators
  trendUp: '#16a34a',
  trendDown: '#dc2626',
  trendNeutral: '#64748b',

  // Scrollbar
  scrollbarThumb: 'rgba(0,0,0,0.12)',
  scrollbarThumbHover: 'rgba(0,0,0,0.2)',
}

// ── Provider ────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => {
    try {
      return localStorage.getItem('astra-theme') || 'dark'
    } catch { return 'dark' }
  })

  const theme = themeName === 'light' ? light : dark

  const toggleTheme = useCallback(() => {
    setThemeName(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('astra-theme', next) } catch {}
      return next
    })
  }, [])

  // Apply theme to CSS custom properties on <html> for scrollbar + utility classes
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', themeName)
    root.style.setProperty('--bg', theme.bg)
    root.style.setProperty('--text', theme.text)
    root.style.setProperty('--border', theme.border)
    root.style.setProperty('--scrollbar-thumb', theme.scrollbarThumb)
    root.style.setProperty('--scrollbar-thumb-hover', theme.scrollbarThumbHover)
    document.body.style.background = theme.bg
    document.body.style.color = theme.text
  }, [themeName, theme])

  return (
    <ThemeContext.Provider value={{ theme, themeName, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// ── Theme Toggle Button Component ───────────────────────────────────────────
export function ThemeToggle({ size = 18, style = {} }) {
  const { themeName, toggleTheme } = useTheme()
  const isDark = themeName === 'dark'

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        ...style,
      }}
    >
      {isDark ? (
        // Sun icon for "switch to light"
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        // Moon icon for "switch to dark"
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  )
}
