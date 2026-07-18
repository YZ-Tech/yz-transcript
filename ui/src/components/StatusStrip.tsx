import { useState } from 'react'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import MemoryIcon from '@mui/icons-material/Memory'
import PauseIcon from '@mui/icons-material/Pause'
import PowerOffIcon from '@mui/icons-material/PowerOff'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import { useApi } from '../lib/api'
import { useCapabilities } from '../lib/capabilities'
import type { TranscriptState } from '../types'

const ABOUT =
  'Long-term memory from ambient capture: every speech segment Silero VAD picks up is ' +
  'transcribed (faster-whisper, multilingual) and persisted here as searchable text. ' +
  'Keyword search filters the loaded day; semantic search runs across all days and languages.'

/** The Memory page's header row — the body-part header's twin, with the VRAM
 *  panel swapped for a status panel (Yeon, 2026-07-10: Memory holds no VRAM
 *  of its own, so the GPU bar was misleading). Same geometry as core's
 *  SubsystemHeader: outlined strip stretching left, the 3-state power
 *  ToggleButtonGroup right (its look copied verbatim from core's
 *  SubsystemPowerToggle — modules can't import core components).
 *
 *  Power drives the generic satellite seam via the host api (on/paused/off).
 *  Standalone SPA renders view-only (no power buttons — capture toggles live
 *  in JarvYZ). */
export function StatusStrip({
  state,
  onChanged,
}: {
  state: TranscriptState
  onChanged: () => void
}) {
  const api = useApi()
  const caps = useCapabilities()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setError(r.error || 'failed')
    else onChanged()
  }

  const standalone = caps.deployTarget === 'standalone'
  const sat = state.satellite
  const recording = state.running && !state.paused

  const power: 'on' | 'paused' | 'off' =
    state.power ?? (state.paused ? 'paused' : state.enabled ? 'on' : 'off')

  const setPower = (next: 'on' | 'paused' | 'off') => {
    if (next === 'on') void call(api.enable)
    else if (next === 'paused') void call(api.pause)
    else void call(api.disable)
  }

  const mode = standalone
    ? 'Standalone'
    : recording
      ? 'Recording'
      : state.paused
        ? 'Paused'
        : state.enabled
          ? 'Enabled'
          : 'Off'
  const detail = standalone
    ? '· view only — capture toggles live in JarvYZ'
    : recording
      ? '· ambient speech is being captured'
      : state.paused
        ? '· capture suspended, history stays searchable'
        : state.enabled
          ? '· not running'
          : '— satellite down: nothing recorded, semantic search unavailable'

  const retention =
    `audio ${state.retention.audio_days || '–'}d · text ` +
    (state.retention.text_days === 0 ? '∞' : `${state.retention.text_days}d`)

  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Stack
          direction="row"
          sx={{
            flex: '1 1 280px',
            minWidth: 0,
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            px: 1.25,
            py: 0.5,
            minHeight: 36,
            boxSizing: 'border-box',
          }}
        >
          <FiberManualRecordIcon
            fontSize="small"
            sx={
              recording
                ? {
                    color: 'error.main',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }
                : { color: state.paused ? 'warning.main' : 'text.disabled' }
            }
          />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {mode}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {detail}
          </Typography>
          <Tooltip title={ABOUT}>
            <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {sat && (
            <Tooltip
              title={
                sat.index_ready
                  ? `Semantic index ready — ${sat.index_count} entries`
                  : 'Semantic index warming up (sentence-transformer cold start)'
              }
            >
              {/* A ready index is a FACT, not a success — muted. Only the
                  anomaly (warming) gets color. */}
              <Chip
                icon={<MemoryIcon sx={{ fontSize: 14 }} />}
                label={sat.index_ready ? `index · ${sat.index_count}` : 'index · warming'}
                size="small"
                color={sat.index_ready ? 'default' : 'warning'}
                variant="outlined"
              />
            </Tooltip>
          )}
          <Tooltip title="Retention — how long entries are kept before pruning">
            <Chip label={retention} size="small" variant="outlined" />
          </Tooltip>
        </Stack>

        {!standalone && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 'auto' }}>
            {busy && (
              <Tooltip title="applying…">
                <CircularProgress size={14} />
              </Tooltip>
            )}
            <ToggleButtonGroup
              exclusive
              size="small"
              value={power}
              disabled={busy}
              onChange={(_e, next: 'on' | 'paused' | 'off' | null) => {
                // exclusive groups emit null when the active button is
                // re-clicked; ignore so the control never lands empty.
                if (next) setPower(next)
              }}
              sx={{ '& .MuiToggleButton-root': { px: 0.9 } }}
            >
              <Tooltip title="On — capturing ambient speech">
                <ToggleButton value="on" color="success" aria-label="On">
                  <PowerSettingsNewIcon fontSize="small" />
                </ToggleButton>
              </Tooltip>
              <Tooltip title="Paused — capture suspended; history stays searchable, instant resume">
                <ToggleButton value="paused" color="warning" aria-label="Pause">
                  <PauseIcon fontSize="small" />
                </ToggleButton>
              </Tooltip>
              <Tooltip title="Off — satellite process down; nothing recorded, search unavailable">
                <ToggleButton value="off" color="error" aria-label="Off">
                  <PowerOffIcon fontSize="small" />
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>
          </Stack>
        )}
      </Stack>

      {sat?.error && <Alert severity="warning">Satellite link issue: {sat.error}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </>
  )
}
