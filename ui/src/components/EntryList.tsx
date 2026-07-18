import { Fragment, useState } from 'react'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DeleteIcon from '@mui/icons-material/Delete'
import { useApi } from '../lib/api'
import type { TranscriptEntry } from '../types'

/** The day's transcript as a READABLE timeline (2026-07-10 redesign): the
 *  words lead, everything else recedes. Time sits in a muted monospace
 *  gutter, meta (lang · duration) and the play/delete actions only appear
 *  on row hover, rows are bare (hairline hover tint, no card chrome), and
 *  bursts of speech are separated by "silence" dividers when the gap
 *  between entries crosses a threshold. Was: one bordered card per
 *  utterance with a metadata HEADLINE row and always-visible buttons —
 *  debug records, not a transcript. */

/** Newest-first list ⇒ the gap between row i-1 (newer) and i (older). */
const GAP_DIVIDER_MIN = 15

function gapLabel(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h} h ${m} min` : `${h} h`
  }
  return `${minutes} min`
}

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
    <Box>
      {entries.map((e, i) => {
        const newer = entries[i - 1]
        const gapMin = newer ? Math.round((newer.ts - e.ts) / 60) : 0
        return (
          <Fragment key={`${e.ts}`}>
            {gapMin >= GAP_DIVIDER_MIN && (
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, py: 0.5 }}>
                <Box sx={{ flex: 1, borderBottom: '1px dashed', borderColor: 'divider' }} />
                <Typography variant="caption" color="text.disabled">
                  {gapLabel(gapMin)} of silence
                </Typography>
                <Box sx={{ flex: 1, borderBottom: '1px dashed', borderColor: 'divider' }} />
              </Stack>
            )}
            <EntryRow
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
          </Fragment>
        )
      })}
    </Box>
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
  const playableUrl = audioName ? api.audioUrl(day, audioName) : null

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '76px 1fr auto',
        alignItems: 'center',
        columnGap: 1.5,
        px: 1,
        py: 0.25,
        borderRadius: 1,
        transition: 'background-color .15s ease',
        bgcolor: isPlaying ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
        // Meta + actions are hover/focus-revealed — the resting feed is
        // just time and words. Rendered (not mounted-on-hover) so row
        // heights never shift.
        '&:hover .entry-actions, &:focus-within .entry-actions': { opacity: 1 },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontFamily: 'ui-monospace, monospace',
          color: isPlaying ? 'primary.main' : 'text.disabled',
        }}
      >
        {timeStr}
      </Typography>
      <Typography variant="body2">{entry.text}</Typography>
      <Stack
        direction="row"
        className="entry-actions"
        sx={{ alignItems: 'center', gap: 0.25, opacity: 0, transition: 'opacity .15s ease' }}
      >
        <Typography variant="caption" color="text.disabled" sx={{ mr: 0.5 }}>
          {(entry.language || '?').toLowerCase()} · {entry.duration.toFixed(1)}s
        </Typography>
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
      </Stack>
    </Box>
  )
}
