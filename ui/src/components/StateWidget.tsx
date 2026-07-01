import { useState } from 'react'
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

  const handleToggle = async () => {
    setBusy(true)
    setError(null)
    const r = state.enabled ? await api.disable() : await api.enable()
    setBusy(false)
    if (!r.ok) setError(r.error || 'failed')
    else onChanged()
  }

  const handlePause = async () => {
    setBusy(true)
    setError(null)
    const r = await api.pause()
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
              label="paused"
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
            <Button
              size="small"
              startIcon={<PauseIcon />}
              onClick={handlePause}
              disabled={busy}
              variant="outlined"
            >
              Pause
            </Button>
          ) : (
            <Button
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={handleResume}
              disabled={busy}
              variant="outlined"
            >
              Resume
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
