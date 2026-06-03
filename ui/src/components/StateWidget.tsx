import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import MemoryIcon from '@mui/icons-material/Memory'
import { useApi } from '../lib/api'
import { useCapabilities } from '../lib/capabilities'
import type { TranscriptState } from '../types'

export function StateWidget({
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
  const [remaining, setRemaining] = useState(state.paused_remaining_seconds)

  // Live countdown of pause-remaining, decrements once per second.
  useEffect(() => {
    if (!state.paused) {
      setRemaining(0)
      return
    }
    setRemaining(state.paused_remaining_seconds)
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          onChanged()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [state.paused, state.paused_remaining_seconds, onChanged])

  const handleToggle = async () => {
    setBusy(true)
    setError(null)
    const r = state.enabled ? await api.disable() : await api.enable()
    setBusy(false)
    if (!r.ok) setError(r.error || 'failed')
    else onChanged()
  }

  const handlePause = async (hours: number) => {
    setBusy(true)
    setError(null)
    const r = await api.pause(hours)
    setBusy(false)
    if (!r.ok) setError(r.error || 'failed')
    else onChanged()
  }

  const handleResume = async () => {
    setBusy(true)
    setError(null)
    const r = await api.resume()
    setBusy(false)
    if (!r.ok) setError(r.error || 'failed')
    else onChanged()
  }

  const standalone = caps.deployTarget === 'standalone'
  const sat = state.satellite

  return (
    <Box
      sx={{
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        mb: 2,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Capture pipeline
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          {state.running && !state.paused && (
            <>
              <FiberManualRecordIcon
                sx={{
                  color: 'error.main',
                  fontSize: 14,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <Chip label="recording" size="small" color="error" />
            </>
          )}
          {state.paused && (
            <Chip
              label={`paused · ${formatRemaining(remaining)}`}
              size="small"
              color="warning"
              icon={<PauseIcon sx={{ fontSize: 14 }} />}
            />
          )}
          {!state.enabled && !standalone && <Chip label="disabled" size="small" />}
          {standalone && <Chip label="standalone (no capture)" size="small" />}
          {state.enabled && !state.running && !state.paused && (
            <Chip label="enabled but not running" size="small" color="warning" />
          )}
          {sat && (
            <Tooltip
              title={
                sat.index_ready
                  ? `Semantic index ready — ${sat.index_count} entries`
                  : 'Semantic index warming up (sentence-transformer cold start)'
              }
            >
              <Chip
                icon={<MemoryIcon sx={{ fontSize: 14 }} />}
                label={sat.index_ready ? `index · ${sat.index_count}` : 'index · warming'}
                size="small"
                color={sat.index_ready ? 'success' : 'default'}
                variant="outlined"
              />
            </Tooltip>
          )}
        </Stack>
        {!standalone &&
          (busy ? (
            <CircularProgress size={20} />
          ) : (
            <Switch checked={state.enabled} onChange={handleToggle} />
          ))}
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {standalone ? (
          <>
            Standalone view of the memory store. Capture toggles live in
            JarvYZ — open the same satellite via the JarvYZ UI to flip them.
            Audio retention: {state.retention.audio_days || '–'}d. Text retention:{' '}
            {state.retention.text_days === 0 ? 'forever' : `${state.retention.text_days}d`}.
          </>
        ) : (
          <>
            Master switch. When enabled, JarvYZ transcribes ambient speech and
            persists each entry in Memory. Audio retention:{' '}
            {state.retention.audio_days}d. Text retention:{' '}
            {state.retention.text_days === 0 ? 'forever' : `${state.retention.text_days}d`}.
          </>
        )}
      </Typography>

      {state.enabled && !standalone && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {!state.paused ? (
            <>
              <Typography variant="caption" color="text.secondary">
                Pause for:
              </Typography>
              <Button size="small" onClick={() => handlePause(1)} disabled={busy}>1h</Button>
              <Button size="small" onClick={() => handlePause(4)} disabled={busy}>4h</Button>
              <Button size="small" onClick={() => handlePause(8)} disabled={busy}>8h</Button>
              <Button size="small" onClick={() => handlePause(24)} disabled={busy}>24h</Button>
            </>
          ) : (
            <Button
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={handleResume}
              disabled={busy}
              variant="outlined"
            >
              Resume now
            </Button>
          )}
        </Stack>
      )}

      {sat?.error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Satellite link issue: {sat.error}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  )
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`
}
