import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import RefreshIcon from '@mui/icons-material/Refresh'
import { ThemeProvider, type Theme } from '@mui/material/styles'

import { ApiContext, type TranscriptApi, useApi } from './lib/api'
import { WSContext, type WSApi, useSubscription } from './lib/ws'
import {
  CapabilitiesContext,
  DEFAULT_CAPABILITIES,
  type Capabilities,
  useCapabilities,
} from './lib/capabilities'

import { StateWidget } from './components/StateWidget'
import { EntryList } from './components/EntryList'
import { SearchBar } from './components/SearchBar'
import { SearchResults } from './components/SearchResults'
import {
  useTranscriptDays,
  useTranscriptEntries,
  useTranscriptState,
} from './hooks/useTranscript'
import type { SearchHit } from './types'


export interface TranscriptPageProps {
  /** Host's MUI theme. Wrapped in our own ThemeProvider so module-side
   *  `useTheme()` reads it. Standalone SPA passes its own theme. */
  theme?: Theme
  /** Host's WS API. Optional — the page re-fetches on tab focus
   *  regardless; WS just makes the count live. */
  wsApi?: WSApi
  /** Host's TranscriptApi — the only way URLs reach this component. */
  api: TranscriptApi
  capabilities?: Capabilities
}


/** Root export — JarvYZ (and the standalone SPA) load this via
 *  @yz-dev/react-dynamic-module. Provides Theme / WS / Api /
 *  Capabilities contexts before rendering the inner page.
 *
 *  No factory store today: transcript UI state is flat + local. If a
 *  future second consumer of transcript state (e.g. a top-bar live-
 *  ticker for the latest entry) appears, that triggers the "second
 *  consumer rule" from SATELLITE_DYNAMIC_MODULES.md → lift the local
 *  state into a factory store + export. */
export function TranscriptPage({ theme, wsApi, api, capabilities }: TranscriptPageProps) {
  const caps = capabilities ?? DEFAULT_CAPABILITIES

  const inner = (
    <ApiContext.Provider value={api}>
      <WSContext.Provider
        value={wsApi ?? { send: () => {}, subscribe: () => () => {}, isConnected: false }}
      >
        <CapabilitiesContext.Provider value={caps}>
          <TranscriptPageInner />
        </CapabilitiesContext.Provider>
      </WSContext.Provider>
    </ApiContext.Provider>
  )

  return theme ? <ThemeProvider theme={theme}>{inner}</ThemeProvider> : inner
}


function TranscriptPageInner() {
  const api = useApi()
  const caps = useCapabilities()
  const { state, refresh: refreshState } = useTranscriptState()
  const { days, refresh: refreshDays } = useTranscriptDays()
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [day, setDay] = useState<string>(today)
  const {
    entries,
    totalDay,
    refresh: refreshEntries,
    loading: entriesLoading,
  } = useTranscriptEntries(day, 200)
  const [forgetMinutes, setForgetMinutes] = useState<number>(5)
  const [forgetBusy, setForgetBusy] = useState(false)
  const [forgetMsg, setForgetMsg] = useState<string | null>(null)

  // Search state, owned here so the EntryList / SearchResults swap
  // is driven by one source of truth.
  const [keywordQuery, setKeywordQuery] = useState('')
  const [semanticHits, setSemanticHits] = useState<SearchHit[] | null>(null)
  const [searchState, setSearchState] = useState<{
    loading: boolean
    error: string | null
    ready: boolean
  }>({ loading: false, error: null, ready: true })
  const isSemantic = semanticHits !== null

  const refreshAll = useCallback(() => {
    void refreshState()
    void refreshDays()
    void refreshEntries()
  }, [refreshState, refreshDays, refreshEntries])

  // Tab-focus refresh. Cheap, covers the gap where WS isn't connected
  // (standalone-SPA boot) without a polling loop.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') refreshAll()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refreshAll])

  // WS push: refresh on any `transcript` event from the bus (entry,
  // forget, prune, ...). Cheap re-fetch — keeps the chart live without
  // a polling loop.
  useSubscription<{ kind?: string }>('transcript', () => {
    refreshAll()
  })

  const handleForget = async () => {
    if (
      !confirm(
        `Drop transcript entries (and their audio) from the last ${forgetMinutes} minutes? Cannot be undone.`,
      )
    ) {
      return
    }
    setForgetBusy(true)
    setForgetMsg(null)
    const r = await api.forget(forgetMinutes)
    setForgetBusy(false)
    if (!r.ok) {
      setForgetMsg(`Failed: ${r.error}`)
    } else {
      const data = (r.data || {}) as { dropped_entries?: number; dropped_audio?: number }
      setForgetMsg(
        `Dropped ${data.dropped_entries || 0} entries and ${data.dropped_audio || 0} audio files.`,
      )
      refreshAll()
    }
  }

  const dayOptions = useMemo(() => {
    const sorted = [...days].sort((a, b) => b.day.localeCompare(a.day))
    const dayList = sorted.map((d) => d.day)
    if (!dayList.includes(today)) dayList.unshift(today)
    return dayList
  }, [days, today])

  // Client-side keyword filter on the loaded day's entries.
  const filteredEntries = useMemo(() => {
    if (!keywordQuery.trim()) return entries
    const needle = keywordQuery.toLowerCase()
    return entries.filter((e) => e.text.toLowerCase().includes(needle))
  }, [entries, keywordQuery])

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          Memory
        </Typography>
        <Button startIcon={<RefreshIcon />} onClick={refreshAll} size="small">
          Refresh
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Long-term memory from ambient capture. When enabled in JarvYZ, every
        speech segment Silero VAD picks up gets transcribed (faster-whisper
        large-v3 multilingual, auto-detect) and persisted here as searchable
        text. The semantic index runs across all stored history — keyword for
        fast filtering, semantic for "what did I say about X" across days +
        languages.
      </Typography>

      <StateWidget state={state} onChanged={refreshState} />

      <SearchBar
        onKeywordChange={setKeywordQuery}
        onResults={setSemanticHits}
        onClear={() => setSemanticHits(null)}
        onSearchState={setSearchState}
      />

      {!isSemantic && (
        <Stack direction="row" sx={{ alignItems: 'center', mb: 2, gap: 1.5 }}>
          <TextField
            select
            label="Day"
            size="small"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {dayOptions.map((d) => (
              <MenuItem key={d} value={d}>
                {d}
                {d === today && ' (today)'}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            {keywordQuery.trim()
              ? `${filteredEntries.length} of ${totalDay} entries match`
              : `${totalDay} entries on disk for this day`}
            {!keywordQuery.trim() && entries.length < totalDay
              ? ` (showing ${entries.length} most recent)`
              : null}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {state.enabled && caps.deployTarget === 'jarvis' && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                size="small"
                type="number"
                label="Forget last (min)"
                value={forgetMinutes}
                onChange={(e) =>
                  setForgetMinutes(Math.max(1, parseInt(e.target.value) || 5))
                }
                sx={{ width: 130 }}
              />
              <Button
                size="small"
                color="error"
                startIcon={<DeleteSweepIcon />}
                onClick={handleForget}
                disabled={forgetBusy}
              >
                Forget
              </Button>
            </Stack>
          )}
        </Stack>
      )}

      {forgetMsg && (
        <Alert
          severity={forgetMsg.startsWith('Failed') ? 'error' : 'info'}
          sx={{ mb: 2 }}
        >
          {forgetMsg}
        </Alert>
      )}

      {isSemantic ? (
        <SearchResults
          hits={semanticHits!}
          loading={searchState.loading}
          error={searchState.error}
          ready={searchState.ready}
        />
      ) : entriesLoading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <EntryList day={day} entries={filteredEntries} onAfterDelete={refreshEntries} />
      )}
    </Box>
  )
}
