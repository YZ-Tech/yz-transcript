import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import type { SearchHit } from '../types'

/** Semantic search results — same quiet timeline rows as EntryList
 *  (2026-07-10 redesign): text leads, a compact day+time gutter left,
 *  lang · score as a muted right-hand caption. Was: one bordered card per
 *  hit fronted by a row of chips.
 *
 *  Renders distinct searching / error / warming / no-match states so an
 *  in-flight search never masquerades as "No matches". */
export function SearchResults({
  hits,
  loading = false,
  error = null,
  ready = true,
}: {
  hits: SearchHit[]
  loading?: boolean
  error?: string | null
  ready?: boolean
}) {
  // In-flight with nothing to show yet → "Searching…", not "No matches".
  // (If stale hits exist we keep showing them — stale-while-revalidate;
  // the SearchBar spinner signals the refresh.)
  if (loading && hits.length === 0) {
    return (
      <Stack sx={{ alignItems: 'center', gap: 1.5, py: 4, color: 'text.secondary' }}>
        <CircularProgress size={26} />
        <Typography variant="body2">Searching all history…</Typography>
      </Stack>
    )
  }
  if (error) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="error.main">
          Search failed: {error}
        </Typography>
      </Box>
    )
  }
  if (!ready) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.disabled">
          Semantic index is warming up — try again in a moment.
        </Typography>
      </Box>
    )
  }
  if (hits.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.disabled">
          No matches.
        </Typography>
      </Box>
    )
  }
  return (
    <Box>
      {hits.map((h) => (
        <HitRow key={`${h.day}-${h.ts}`} hit={h} />
      ))}
    </Box>
  )
}

function HitRow({ hit }: { hit: SearchHit }) {
  const d = new Date(hit.ts * 1000)
  const when =
    d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '96px 1fr auto',
        alignItems: 'center',
        columnGap: 1.5,
        px: 1,
        py: 0.25,
        borderRadius: 1,
        transition: 'background-color .15s ease',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontFamily: 'ui-monospace, monospace', color: 'text.disabled' }}
        title={hit.day}
      >
        {when}
      </Typography>
      <Typography variant="body2">{hit.text}</Typography>
      <Typography variant="caption" color="text.disabled">
        {(hit.language || '?').toLowerCase()} · {hit.score.toFixed(2)}
      </Typography>
    </Box>
  )
}
