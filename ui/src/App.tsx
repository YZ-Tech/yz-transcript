// Standalone SPA entry. Used by `vite dev` and `vite build --mode pages`.
// In this mode the page IS the transcript satellite — no JarvYZ wrapper.

import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { TranscriptPage } from './TranscriptPage'
import { createSatelliteApi } from './lib/api'
import type { Capabilities } from './lib/capabilities'
import type { WSApi } from './lib/ws'

const api = createSatelliteApi({ apiBase: '' })

const theme = createTheme({
  palette: {
    mode: 'dark',
    // Distinct hue so two satellite tabs side-by-side are tell-apart-able:
    //   music = pink, people = violet, transcript = teal.
    primary: { main: '#26c6da' },
    background: { default: '#0d0d12', paper: '#15151c' },
  },
})

const capabilities: Capabilities = {
  apiBase: '',
  deployTarget: 'standalone',
  hasAudio: false, // satellite is text-only; audio lives JarvYZ-side
}


/** WS bridge for the standalone SPA — connects to /events on mount,
 *  auto-reconnects with backoff, dispatches each server-pushed message
 *  to subscribers. */
function useStandaloneWs(): WSApi {
  const [isConnected, setIsConnected] = useState(false)
  const subscribersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let cancelled = false
    let backoff = 0.5
    function open() {
      if (cancelled) return
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${location.host}/events`)
      wsRef.current = ws
      ws.onopen = () => {
        backoff = 0.5
        setIsConnected(true)
      }
      ws.onclose = () => {
        setIsConnected(false)
        if (cancelled) return
        backoff = Math.min(backoff * 2, 8)
        setTimeout(open, backoff * 1000)
      }
      ws.onerror = () => { /* will trigger onclose */ }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          const event = msg.event
          if (!event) return
          const { event: _drop, ...payload } = msg
          const subs = subscribersRef.current.get(event)
          if (!subs) return
          for (const cb of subs) {
            try { cb(payload) } catch { /* per-sub error doesn't break others */ }
          }
        } catch { /* not JSON or malformed — ignore */ }
      }
    }
    open()
    return () => {
      cancelled = true
      try { wsRef.current?.close() } catch { /* ignore */ }
    }
  }, [])

  return {
    isConnected,
    send: () => { /* satellite /events doesn't need subscribe messages */ },
    subscribe: (eventType, cb) => {
      let set = subscribersRef.current.get(eventType)
      if (!set) {
        set = new Set()
        subscribersRef.current.set(eventType, set)
      }
      set.add(cb)
      return () => {
        set!.delete(cb)
      }
    },
  }
}


function StandaloneHeader() {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <strong style={{ fontSize: '1.05rem', letterSpacing: '0.02em' }}>
          Memory
        </strong>
        <span style={{ fontSize: '0.75rem', opacity: 0.55 }}>transcript satellite · standalone</span>
      </div>
    </header>
  )
}


function StandaloneRoot() {
  const wsApi = useStandaloneWs()
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
        <StandaloneHeader />
        <TranscriptPage theme={theme} api={api} wsApi={wsApi} capabilities={capabilities} />
      </div>
    </ThemeProvider>
  )
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneRoot />
  </StrictMode>,
)
