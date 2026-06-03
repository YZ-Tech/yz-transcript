import { useState } from 'react'
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DeleteIcon from '@mui/icons-material/Delete'
import { useApi } from '../lib/api'
import type { TranscriptEntry } from '../types'

export function EntryList({
  day,
  entries,
  onAfterDelete,
}: {
  day: string
  entries: TranscriptEntry[]
  onAfterDelete?: () => void
}) {
  const api = useApi()
  const [playing, setPlaying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  if (entries.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.disabled">
          No entries for this day.
        </Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={0.75}>
      {entries.map((e) => (
        <EntryRow
          key={`${e.ts}`}
          day={day}
          entry={e}
          isPlaying={playing === e.audio_path}
          isDeleting={deleting === e.ts}
          onPlayStart={() => setPlaying(e.audio_path || null)}
          onPlayEnd={() => setPlaying(null)}
          onDelete={async () => {
            setDeleting(e.ts)
            const r = await api.deleteEntry(day, e.ts)
            setDeleting(null)
            if (r.ok) onAfterDelete?.()
          }}
        />
      ))}
    </Stack>
  )
}

function EntryRow({
  day,
  entry,
  isPlaying,
  isDeleting,
  onPlayStart,
  onPlayEnd,
  onDelete,
}: {
  day: string
  entry: TranscriptEntry
  isPlaying: boolean
  isDeleting: boolean
  onPlayStart: () => void
  onPlayEnd: () => void
  onDelete: () => void
}) {
  const api = useApi()
  const ts = new Date(entry.ts * 1000)
  const timeStr = ts.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const audioName = entry.audio_path?.split('/').pop()
  // Only render the play button when the host actually serves audio
  // for this clip. Standalone-SPA mode returns null → no button.
  const playableUrl =
    audioName ? api.audioUrl(day, audioName) : null

  return (
    <Box
      sx={{
        p: 1.25,
        border: 1,
        borderColor: isPlaying ? 'primary.main' : 'divider',
        borderRadius: 1,
        bgcolor: isPlaying ? 'action.hover' : 'background.paper',
        transition: 'all .15s ease',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'ui-monospace, monospace',
            color: 'text.disabled',
            minWidth: 72,
          }}
        >
          {timeStr}
        </Typography>
        <Chip
          label={entry.language.toUpperCase() || '?'}
          size="small"
          variant="outlined"
          sx={{ height: 18, fontSize: '0.6rem' }}
        />
        <Typography variant="caption" color="text.disabled">
          {entry.duration.toFixed(1)}s
        </Typography>
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 0.25 }}>
          {playableUrl && (
            <IconButton
              size="small"
              onClick={() => {
                onPlayStart()
                const a = new Audio(playableUrl)
                a.onended = onPlayEnd
                a.onerror = onPlayEnd
                a.play().catch(() => onPlayEnd())
              }}
            >
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton
            size="small"
            onClick={onDelete}
            disabled={isDeleting}
            sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Stack>
      <Typography variant="body2" sx={{ pl: 0.5, fontFamily: 'Georgia, serif' }}>
        {entry.text}
      </Typography>
    </Box>
  )
}
