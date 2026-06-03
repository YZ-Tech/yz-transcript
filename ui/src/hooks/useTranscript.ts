// React hooks for transcript data. Reads via the injected TranscriptApi
// adapter — works against the satellite directly (standalone SPA) or
// via JarvYZ's `/api/transcript/*` proxy (embedded mode).

import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../lib/api'
import type {
  SearchHit,
  TranscriptDay,
  TranscriptEntry,
  TranscriptState,
} from '../types'

const DEFAULT_STATE: TranscriptState = {
  enabled: false,
  running: false,
  paused: false,
  pause_until: 0,
  paused_remaining_seconds: 0,
  retention: { text_days: 0, audio_days: 30 },
}

export function useTranscriptState() {
  const api = useApi()
  const [state, setState] = useState<TranscriptState>(DEFAULT_STATE)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setState(await api.state())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { state, error, loading, refresh }
}

export function useTranscriptDays() {
  const api = useApi()
  const [days, setDays] = useState<TranscriptDay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setDays(await api.days())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { days, error, loading, refresh }
}

export function useTranscriptEntries(day: string | null, limit = 200) {
  const api = useApi()
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [totalDay, setTotalDay] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!day) return
    setLoading(true)
    try {
      const data = await api.list(day, limit)
      setEntries(data.entries || [])
      setTotalDay(data.total_day || 0)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api, day, limit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { entries, totalDay, error, loading, refresh }
}

export function useTranscriptSearch() {
  const api = useApi()
  const [hits, setHits] = useState<SearchHit[]>([])
  const [ready, setReady] = useState(true)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(
    async (params: {
      q: string
      since_iso?: string
      until_iso?: string
      language?: string
      limit?: number
    }) => {
      if (!params.q.trim()) {
        setHits([])
        setReady(true)
        return
      }
      setLoading(true)
      try {
        const data = await api.search(params)
        setHits(data.entries || [])
        setReady(data.ready)
        setCount(data.count)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [api],
  )

  const clear = useCallback(() => {
    setHits([])
    setError(null)
  }, [])

  return { hits, ready, count, error, loading, run, clear }
}
