import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  ClickAwayListener,
  Collapse,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
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

import { ConfirmDialog } from './components/ConfirmDialog'
import { StatusStrip } from './components/StatusStrip'

/** Toolbar icon buttons match the row's 40px control height and wear the
 *  same outline as the fields/toggles, so the line reads as one family. */
const TOOLBAR_ICON_SX = {
  width: 40,
  height: 40,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
} as const
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
  // The minutes input hides behind the forget icon (horizontal collapse):
  // first click arms + reveals, second click fires, click-away disarms.
  const [forgetOpen, setForgetOpen] = useState(false)

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

  // Power flips from the HOST header (core SubsystemHeader → POST
  // /api/satellites/power) ride the `satellite_power` event, not the
  // `transcript` channel — without this the strip showed the old state
  // until the next tab-focus refresh (2026-07-10).
  useSubscription<{ id?: string }>('satellite_power', (d) => {
    if (d.id === 'transcript') void refreshState()
  })

  // Armed by the second click on the forget icon; the themed
  // ConfirmDialog (below) fires handleForget on confirm.
  const [confirmForget, setConfirmForget] = useState(false)
  const handleForget = async () => {
    setForgetBusy(true)
    setForgetMsg(null)
    const r = await api.forget(forgetMinutes)
    setForgetBusy(false)
    setForgetOpen(false)
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
    <Stack sx={{ gap: 2 }}>
      <StatusStrip state={state} onChanged={refreshState} />

      {/* ONE toolbar row (2026-07-10 restyle): search left, day + forget +
          refresh right, wrapping on narrow. Was two stacked rows. */}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <SearchBar
          onKeywordChange={setKeywordQuery}
          onResults={setSemanticHits}
          onClear={() => setSemanticHits(null)}
          onSearchState={setSearchState}
        />
        {!isSemantic && (
          <>
            <TextField
              select
              label="Day"
              size="small"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              sx={{ minWidth: 170 }}
            >
              {dayOptions.map((d) => (
                <MenuItem key={d} value={d}>
                  {d}
                  {d === today && ' (today)'}
                </MenuItem>
              ))}
            </TextField>
            {state.enabled && caps.deployTarget === 'jarvis' && (
              <ClickAwayListener onClickAway={() => setForgetOpen(false)}>
                <Stack direction="row" sx={{ alignItems: 'center' }}>
                  <Collapse in={forgetOpen} orientation="horizontal">
                    <TextField
                      size="small"
                      type="number"
                      label="Minutes"
                      value={forgetMinutes}
                      onChange={(e) =>
                        setForgetMinutes(Math.max(1, parseInt(e.target.value) || 5))
                      }
                      sx={{ width: 96, mr: 1 }}
                    />
                  </Collapse>
                  <Tooltip
                    title={
                      forgetOpen
                        ? `Forget the last ${forgetMinutes} min of entries + audio — cannot be undone`
                        : 'Forget recent minutes…'
                    }
                  >
                    <IconButton
                      onClick={() => (forgetOpen ? setConfirmForget(true) : setForgetOpen(true))}
                      disabled={forgetBusy}
                      color={forgetOpen ? 'error' : 'default'}
                      sx={TOOLBAR_ICON_SX}
                    >
                      <DeleteSweepIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </ClickAwayListener>
            )}
            <ConfirmDialog
              open={confirmForget}
              title="Forget recent entries"
              message={`Drop transcript entries (and their audio) from the last ${forgetMinutes} minutes? Cannot be undone.`}
              confirmLabel="Forget"
              onConfirm={() => void handleForget()}
              onClose={() => setConfirmForget(false)}
            />
          </>
        )}
        <Tooltip title="Refresh">
          <IconButton onClick={refreshAll} sx={TOOLBAR_ICON_SX}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Count caption only while a filter is ACTIVE (it describes the
          filter). The unfiltered "N entries on disk" duplicated the feed's
          own empty state ("No entries for this day") — same info, twice on
          screen (Yeon, 2026-07-10). The truncation note stays: it's the one
          fact the feed can't show about itself. */}
      {!isSemantic && keywordQuery.trim() && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
          {`${filteredEntries.length} of ${totalDay} entries match`}
        </Typography>
      )}
      {!isSemantic && !keywordQuery.trim() && entries.length < totalDay && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
          {`showing the ${entries.length} most recent of ${totalDay} entries`}
        </Typography>
      )}

      {forgetMsg && (
        <Alert severity={forgetMsg.startsWith('Failed') ? 'error' : 'info'}>
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
    </Stack>
  )
}
