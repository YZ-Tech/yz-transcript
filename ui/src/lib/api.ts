// Semantic API contract for the transcript module.
//
// Pattern lifted from satellites/yz-people/ui/src/lib/api.ts. The module
// declares named operations; the host (JarvYZ or standalone SPA)
// provides an implementation. URL schemes don't reach the components.
//
// Adapters shipped with the module:
//   - createSatelliteApi() — wraps the satellite's native routes
//     (/entries, /days, /state, /search). Used by the standalone SPA.
//   - createJarvYZApi() — wraps JarvYZ's `/api/transcript/*` proxy.
//     Used by the JarvYZ-embedded host loader.

import { createContext, useContext } from 'react'
import type {
  SearchResponse,
  TranscriptDay,
  TranscriptListResponse,
  TranscriptState,
} from '../types'


export interface TranscriptApi {
  // Reads
  list(day: string | null, limit: number): Promise<TranscriptListResponse>
  days(): Promise<TranscriptDay[]>
  state(): Promise<TranscriptState>
  search(params: {
    q: string
    since_iso?: string
    until_iso?: string
    language?: string
    limit?: number
  }): Promise<SearchResponse>

  // Mutations
  enable(): Promise<{ ok: boolean; error?: string }>
  disable(): Promise<{ ok: boolean; error?: string }>
  /** Indefinite pause (the timed snooze was removed 2026-07-01). */
  pause(): Promise<{ ok: boolean; error?: string }>
  resume(): Promise<{ ok: boolean; error?: string }>
  forget(minutes: number): Promise<{ ok: boolean; error?: string; data?: unknown }>
  prune(): Promise<{ ok: boolean; error?: string; data?: unknown }>
  deleteEntry(day: string, ts: number): Promise<{ ok: boolean; error?: string }>

  /** URL the browser can <audio src=...> on for playback. Optional —
   *  in standalone mode the satellite doesn't serve audio; the UI hides
   *  the play button when this returns null. */
  audioUrl(day: string, name: string): string | null
}


// ---------------------------------------------------------------------------


export class NotSupportedError extends Error {
  constructor(operation: string) {
    super(`Operation '${operation}' is not supported by this host`)
    this.name = 'NotSupportedError'
  }
}

const stub = <T>(name: string): Promise<T> =>
  Promise.reject(new NotSupportedError(name))

const NO_API: TranscriptApi = {
  list: () => stub('list'),
  days: () => stub('days'),
  state: () => stub('state'),
  search: () => stub('search'),
  enable: () => stub('enable'),
  disable: () => stub('disable'),
  pause: () => stub('pause'),
  resume: () => stub('resume'),
  forget: () => stub('forget'),
  prune: () => stub('prune'),
  deleteEntry: () => stub('deleteEntry'),
  audioUrl: () => null,
}

export const ApiContext = createContext<TranscriptApi>(NO_API)
export const useApi = () => useContext(ApiContext)


// ---------------------------------------------------------------------------
// Common HTTP helpers


async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`)
  return (await r.json()) as T
}

async function postEmpty(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method: 'POST' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return { ok: false, error: (d as { detail?: string }).detail || `HTTP ${r.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, error: (data as { detail?: string }).detail || `HTTP ${r.status}` }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function deleteRequest(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return { ok: false, error: (d as { detail?: string }).detail || `HTTP ${r.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}


// ---------------------------------------------------------------------------
// Satellite adapter — talks directly to the standalone daemon's routes.
// Capture-state endpoints (enable/disable/pause/resume) aren't owned by
// the satellite; they no-op cleanly so the same UI works in both modes.


export function createSatelliteApi(
  { apiBase = '' }: { apiBase?: string } = {},
): TranscriptApi {
  return {
    list: (day, limit) =>
      getJson<TranscriptListResponse>(
        `${apiBase}/entries?limit=${limit}` + (day ? `&day=${day}` : ''),
      ),
    days: () => getJson<{ days: TranscriptDay[] }>(`${apiBase}/days`).then((d) => d.days || []),
    state: async () => {
      // Satellite's /state is a subset of the JarvYZ-side projection.
      // Synthesize the missing capture flags so the UI doesn't crash.
      const sat = await getJson<{
        today_count: number
        last_entry_ts: number | null
        index_ready: boolean
        index_count: number
        retention: { text_days: number }
      }>(`${apiBase}/state`)
      return {
        enabled: false,       // standalone mode = no JarvYZ = no capture
        running: false,
        paused: false,
        retention: { text_days: sat.retention.text_days, audio_days: 0 },
        satellite: {
          today_count: sat.today_count,
          last_entry_ts: sat.last_entry_ts,
          index_ready: sat.index_ready,
          index_count: sat.index_count,
        },
      }
    },
    search: ({ q, since_iso, until_iso, language, limit }) => {
      const params = new URLSearchParams({ q })
      if (since_iso) params.set('since_iso', since_iso)
      if (until_iso) params.set('until_iso', until_iso)
      if (language) params.set('language', language)
      if (limit) params.set('limit', String(limit))
      return getJson<SearchResponse>(`${apiBase}/search?${params}`)
    },

    // Capture toggles live JarvYZ-side. In standalone mode they no-op
    // cleanly with a friendly error so the buttons render but say so.
    enable: () => Promise.resolve({
      ok: false,
      error: 'Capture is owned by JarvYZ. Use the JarvYZ-embedded UI to start/stop.',
    }),
    disable: () => Promise.resolve({ ok: false, error: 'Capture is owned by JarvYZ.' }),
    pause: () => Promise.resolve({ ok: false, error: 'Capture is owned by JarvYZ.' }),
    resume: () => Promise.resolve({ ok: false, error: 'Capture is owned by JarvYZ.' }),
    forget: (minutes) => postJson(`${apiBase}/state/forget`, { minutes }),
    prune: () => postEmpty(`${apiBase}/state/prune`),
    deleteEntry: (day, ts) =>
      deleteRequest(`${apiBase}/entries?day=${day}&ts=${ts}`),

    // No audio in standalone mode (the satellite is text-only).
    audioUrl: () => null,
  }
}


// ---------------------------------------------------------------------------
// JarvYZ-embedded adapter — talks to JarvYZ's `/api/transcript/*` proxy.


export function createJarvYZApi(): TranscriptApi {
  return {
    list: (day, limit) =>
      getJson<TranscriptListResponse>(
        `/api/transcript/entries?limit=${limit}` + (day ? `&day=${day}` : ''),
      ),
    days: () => getJson<{ days: TranscriptDay[] }>('/api/transcript/days').then((d) => d.days || []),
    state: () => getJson<TranscriptState>('/api/transcript/state'),
    search: ({ q, since_iso, until_iso, language, limit }) => {
      const params = new URLSearchParams({ q })
      if (since_iso) params.set('since_iso', since_iso)
      if (until_iso) params.set('until_iso', until_iso)
      if (language) params.set('language', language)
      if (limit) params.set('limit', String(limit))
      return getJson<SearchResponse>(`/api/transcript/search?${params}`)
    },
    // Power collapsed into the generic satellite-power endpoint (on/paused/off).
    enable: () => postJson('/api/satellites/power', { id: 'transcript', state: 'on' })
      .then((r) => ({ ok: r.ok, error: r.error })),
    disable: () => postJson('/api/satellites/power', { id: 'transcript', state: 'off' })
      .then((r) => ({ ok: r.ok, error: r.error })),
    pause: () => postJson('/api/satellites/power', { id: 'transcript', state: 'paused' })
      .then((r) => ({ ok: r.ok, error: r.error })),
    resume: () => postJson('/api/satellites/power', { id: 'transcript', state: 'on' })
      .then((r) => ({ ok: r.ok, error: r.error })),
    forget: (minutes) => postJson('/api/transcript/forget', { minutes }),
    prune: () => postEmpty('/api/transcript/prune'),
    deleteEntry: (day, ts) =>
      deleteRequest(`/api/transcript/entry?day=${day}&ts=${ts}`),

    audioUrl: (day, name) => `/api/transcript/audio/${day}/${encodeURIComponent(name)}`,
  }
}
