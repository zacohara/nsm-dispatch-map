import { useMemo, useState } from 'react'

// 7a–7p visible axis. Times outside this window still render, just clamped.
const HOUR_START = 7
const HOUR_END = 19
const HOUR_SPAN = HOUR_END - HOUR_START

// "HH:MM" → fractional hours, or null
function timeToHours(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h)) return null
  return h + (m || 0) / 60
}

// Map (hours since midnight) → left% on the 7a–7p axis, clamping to the edges.
function hoursToPct(h) {
  if (h == null) return null
  const clamped = Math.max(HOUR_START, Math.min(HOUR_END, h))
  return ((clamped - HOUR_START) / HOUR_SPAN) * 100
}

// Tier labels for the badge next to each rep name
const TIER_DOT = {
  1: '#10b981',  // preferred — green
  2: null,       // standard — no dot
  3: '#f59e0b',  // backup — amber
}

export default function GanttStrip({
  crews,
  tasks,
  date,
  selectedCrewId,
  onSelectCrew,
  onSelectTask,
  fitResult,
  previewSuggestion,
}) {
  const [collapsed, setCollapsed] = useState(true)
  // Proposed-slot width reflects the duration the dispatcher picked in FitPanel.
  // Fall back to 2h if the server didn't echo it back.
  const duration = Number(fitResult?.duration_hrs) || 2

  // Sort reps: preferred tier first, then standard, then backup; within each
  // tier alphabetically. Reps with no active tasks or blockers on this day
  // sink to the bottom but still appear so dispatcher can see open capacity.
  const sortedCrews = useMemo(() => {
    const scored = crews.map(c => {
      const todays = tasks.filter(t => t.crew_id === c.id)
      const hasWork = todays.some(t => !t.is_blocker)
      return { c, hasWork, taskCount: todays.length }
    })
    return scored
      .sort((a, b) => {
        if (a.hasWork !== b.hasWork) return a.hasWork ? -1 : 1
        const ta = a.c.priority_tier ?? 2
        const tb = b.c.priority_tier ?? 2
        if (ta !== tb) return ta - tb
        return (a.c.name || '').localeCompare(b.c.name || '')
      })
      .map(s => s.c)
  }, [crews, tasks])

  // Group fit-search previews by rep so we can overlay them on the timeline.
  // We don't have an exact start_time for the new slot (that's the point of
  // the fit logic), but we approximate it the same way the server does so
  // dispatchers can see roughly where the new estimate would land.
  // Only overlay fit hints for suggestions whose day matches the viewed date.
  // Suggestions for other days exist in fitResult but belong on those days'
  // timelines, not this one. Keep the best-ranked matching suggestion per rep.
  const fitHintsByRep = useMemo(() => {
    const out = {}
    if (!fitResult?.suggestions?.length || !date) return out
    fitResult.suggestions.forEach((s, idx) => {
      if (s.day !== date) return
      if (out[s.rep_id]) return // keep the first (highest-ranked) match
      const stops = s.day_stops || []
      const k = s.insert_index ?? stops.length
      let startH
      if (k === 0) {
        const first = stops[0]
        const anchor = timeToHours(first?.start_time)
        startH = anchor != null ? Math.max(8, anchor - 2) : 8
      } else if (k === stops.length) {
        const last = stops[stops.length - 1]
        const anchor = timeToHours(last?.start_time)
        startH = anchor != null ? anchor + 2 : 14
      } else {
        const prev = stops[k - 1]
        const anchor = timeToHours(prev?.start_time)
        startH = anchor != null ? anchor + 1.5 : 12
      }
      out[s.rep_id] = { startH, endH: startH + duration, rank: idx + 1 }
    })
    return out
  }, [fitResult, duration, date])

  const highlightRepId = previewSuggestion?.rep_id || null

  const HOURS = []
  for (let h = HOUR_START; h <= HOUR_END; h++) HOURS.push(h)

  if (sortedCrews.length === 0) return null

  return (
    <div className="border-t border-mortar-800 bg-mortar-950">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-3 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-ns-400 hover:bg-mortar-900 transition font-display"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 3v18h18" />
            <rect x="6" y="10" width="4" height="8" fill="currentColor" stroke="none" />
            <rect x="12" y="6" width="4" height="12" fill="currentColor" stroke="none" />
            <rect x="18" y="13" width="3" height="5" fill="currentColor" stroke="none" />
          </svg>
          Timeline · 7a–7p
          <span className="text-mortar-500 normal-case tracking-normal font-sans">
            {sortedCrews.length} rep{sortedCrews.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="text-mortar-500">{collapsed ? '▲ show' : '▼ hide'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-mortar-800 max-h-[220px] overflow-y-auto overflow-x-auto">
          <div className="min-w-[640px]">
          {/* Hour axis header */}
          <div className="sticky top-0 z-10 bg-mortar-950 flex border-b border-mortar-800 text-[9px] text-mortar-500 uppercase tracking-wider">
            <div className="w-[130px] flex-shrink-0 px-2 py-1 border-r border-mortar-800">Rep</div>
            <div className="flex-1 relative h-6">
              {HOURS.map(h => {
                const pct = ((h - HOUR_START) / HOUR_SPAN) * 100
                return (
                  <div
                    key={h}
                    className="absolute top-0 h-full border-l border-mortar-800/60 px-1 pt-0.5"
                    style={{ left: `${pct}%` }}
                  >
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Rep rows */}
          {sortedCrews.map(c => {
            const rowTasks = tasks.filter(t => t.crew_id === c.id)
            const realTasks = rowTasks.filter(t => !t.is_blocker)
            const blockers = rowTasks.filter(t => t.is_blocker)
            const fitHint = fitHintsByRep[c.id]
            const isHighlighted = highlightRepId === c.id
            const isSelected = selectedCrewId === c.id
            const tierDot = TIER_DOT[c.priority_tier ?? 2]

            return (
              <div
                key={c.id}
                className={[
                  'flex border-b border-mortar-800/60 transition',
                  isSelected ? 'bg-mortar-900' : 'hover:bg-mortar-900/40',
                  isHighlighted ? 'ring-1 ring-ns-500 ring-inset' : '',
                ].join(' ')}
              >
                {/* Rep cell */}
                <button
                  type="button"
                  onClick={() => onSelectCrew?.(isSelected ? null : c.id)}
                  className="w-[130px] flex-shrink-0 px-2 py-1.5 border-r border-mortar-800 flex items-center gap-1.5 text-left hover:bg-mortar-800/60"
                >
                  {c.avatar_url ? (
                    <img
                      src={c.avatar_url}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                      style={{ boxShadow: `0 0 0 1.5px ${c.color}` }}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: c.color }}
                    />
                  )}
                  <span className="text-[11px] text-mortar-300 truncate flex-1">
                    {c.name.split(' ')[0]}
                  </span>
                  {tierDot && (
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: tierDot }}
                      title={c.priority_tier === 1 ? 'Preferred' : 'Backup'}
                    />
                  )}
                </button>

                {/* Timeline track */}
                <div className="flex-1 relative h-7">
                  {/* Hour gridlines */}
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-l border-mortar-800/40"
                      style={{ left: `${((h - HOUR_START) / HOUR_SPAN) * 100}%` }}
                    />
                  ))}

                  {/* Blockers — hatched amber */}
                  {blockers.map(b => {
                    const startH = timeToHours(b.start_time)
                    const endH = startH != null ? startH + (b.duration_hrs || 1) : null
                    const isFullDay = startH == null || (b.duration_hrs || 0) >= 6
                    const left = isFullDay ? 0 : hoursToPct(startH)
                    const right = isFullDay ? 100 : hoursToPct(endH)
                    const width = Math.max(1, right - left)
                    return (
                      <div
                        key={b.id}
                        className="absolute top-1 bottom-1 rounded"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.35) 0 4px, rgba(245,158,11,0.15) 4px 8px)',
                          border: '1px solid rgba(245,158,11,0.5)',
                        }}
                        title={`${b.task_description || b.job_name || 'Unavailable'}${b.start_time ? ` · ${b.start_time}` : ' · all day'}`}
                      />
                    )
                  })}

                  {/* Real tasks — colored blocks */}
                  {realTasks.map(t => {
                    const startH = timeToHours(t.start_time)
                    if (startH == null) {
                      // TBD-time task — small chip pinned to the start of day
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onSelectTask?.(t.id)}
                          className="absolute top-1 bottom-1 rounded text-[9px] text-white font-semibold px-1 truncate"
                          style={{
                            left: 0,
                            width: '5%',
                            background: c.color,
                            opacity: 0.7,
                            border: '1px dashed rgba(255,255,255,0.4)',
                          }}
                          title={`${t.job_name || ''} · time TBD`}
                        >?</button>
                      )
                    }
                    const endH = startH + (t.duration_hrs || 1)
                    const left = hoursToPct(startH)
                    const width = Math.max(1.5, hoursToPct(endH) - left)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onSelectTask?.(t.id)}
                        className="absolute top-1 bottom-1 rounded text-[9px] text-white font-semibold px-1 truncate text-left hover:brightness-125 transition"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: c.color,
                          borderLeft: `3px solid ${t.task_category_color || '#ffffff40'}`,
                        }}
                        title={`${t.job_name || ''} · ${t.start_time} · ${t.duration_hrs || 1}h · ${t.job_address || ''}`}
                      >
                        {t.job_name || 'Job'}
                      </button>
                    )
                  })}

                  {/* Fit-search preview overlay — only rendered for reps whose
                      best suggestion is on the viewed date (see fitHintsByRep). */}
                  {fitHint && (
                    <div
                      className="absolute top-0 bottom-0 rounded pointer-events-none animate-pulse"
                      style={{
                        left: `${hoursToPct(fitHint.startH)}%`,
                        width: `${Math.max(2, hoursToPct(fitHint.endH) - hoursToPct(fitHint.startH))}%`,
                        background: 'rgba(74,157,207,0.25)',
                        border: '2px dashed #4a9dcf',
                      }}
                      title={`Proposed slot · ~${Math.round(fitHint.startH)}:00 · ${duration}h`}
                    >
                      <div className="absolute -top-4 left-0 text-[8px] text-ns-300 font-bold uppercase whitespace-nowrap">
                        #{fitHint.rank} fit
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Legend */}
          <div className="px-3 py-1.5 border-t border-mortar-800 text-[9px] text-mortar-500 flex items-center gap-4 flex-wrap bg-mortar-950">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: '#10b981' }} /> Preferred
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: '#f59e0b' }} /> Backup
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-2 rounded" style={{ background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.35) 0 3px, rgba(245,158,11,0.15) 3px 6px)' }} /> Unavailable
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-2 rounded border-2 border-dashed" style={{ borderColor: '#4a9dcf', background: 'rgba(74,157,207,0.25)' }} /> Proposed slot
            </span>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
