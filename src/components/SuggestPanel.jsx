import { useMemo, useState } from 'react'
import { recommendSwaps } from '../lib/recommender'

// `embedded`: when true, the trigger renders as a small icon button suitable
// for stuffing into an existing header (the LeftPanel). When false (legacy),
// renders as the floating bottom-right pill. The modal portion is identical
// either way.
export default function SuggestPanel({ crews, tasks, onApplySwap, onFlash, embedded = false }) {
  const [open, setOpen] = useState(false)
  const [applyingId, setApplyingId] = useState(null)
  const [dismissedIds, setDismissedIds] = useState(() => new Set())

  const suggestions = useMemo(() => {
    const all = recommendSwaps(crews, tasks)
    return all.filter(s => !dismissedIds.has(s.task_id))
  }, [crews, tasks, dismissedIds])

  const totalSaving = useMemo(
    () => suggestions.reduce((s, x) => s + x.miles_saved, 0),
    [suggestions]
  )

  const handleApply = async (s) => {
    setApplyingId(s.task_id)
    try {
      await onApplySwap(s.task_id, s.to_crew_id, 'suggestion')
      onFlash?.(`Moved '${s.task_name}' to ${s.to_crew_name} (saves ${s.miles_saved}mi)`, 'success')
      // Dismiss this suggestion so it doesn't re-appear until state refreshes
      setDismissedIds(prev => {
        const next = new Set(prev)
        next.add(s.task_id)
        return next
      })
    } catch (e) {
      onFlash?.(`Failed to move: ${e.message}`, 'error')
    } finally {
      setApplyingId(null)
    }
  }

  const handleDismiss = (taskId) => {
    setDismissedIds(prev => {
      const next = new Set(prev)
      next.add(taskId)
      return next
    })
  }

  return (
    <>
      {embedded ? (
        // Inline button — designed to live in the LeftPanel header. No fixed
        // positioning, no animation by default (badge alone signals new
        // suggestions). Compact enough to sit next to "9 active · 26 tasks".
        <button
          onClick={() => setOpen(v => !v)}
          className={[
            'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider border transition flex-shrink-0',
            suggestions.length > 0
              ? 'bg-ns-500/90 hover:bg-ns-400 text-white border-ns-300'
              : 'bg-mortar-900 hover:bg-mortar-800 text-mortar-400 border-mortar-700',
          ].join(' ')}
          title={suggestions.length > 0
            ? `${suggestions.length} improvement${suggestions.length === 1 ? '' : 's'} available — saves ${totalSaving}mi`
            : 'No route improvements found'}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span>Improve</span>
          {suggestions.length > 0 && (
            <span className="bg-white/30 px-1.5 py-0.5 rounded text-[9px] font-bold leading-none">
              {suggestions.length}
            </span>
          )}
        </button>
      ) : (
        // Legacy floating bottom-right pill. Kept for backward compat in case
        // we want to use the panel in another surface later.
        <button
          onClick={() => setOpen(v => !v)}
          className={[
            'fixed bottom-24 right-4 z-[2000] flex items-center gap-2',
            'px-4 py-2.5 rounded-full font-semibold text-sm shadow-2xl',
            'transition-all border-2',
            suggestions.length > 0
              ? 'bg-ns-500 hover:bg-ns-400 text-white border-ns-300 shadow-ns-900/50'
              : 'bg-mortar-800 hover:bg-mortar-700 text-mortar-300 border-mortar-700',
          ].join(' ')}
          style={suggestions.length > 0 ? { animation: 'pulse-suggest 2.4s ease-in-out infinite' } : undefined}
          title={suggestions.length > 0
            ? `${suggestions.length} improvement${suggestions.length === 1 ? '' : 's'} available`
            : 'No improvements found'}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span>Suggest improvements</span>
          {suggestions.length > 0 && (
            <span className="ml-1 bg-white/25 px-2 py-0.5 rounded-full text-[11px] font-bold">
              {suggestions.length}
            </span>
          )}
        </button>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-[3100] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl max-h-[80vh] bg-mortar-900 rounded-xl border border-mortar-800 shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3 brick-texture border-b border-mortar-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display">
                  Route Optimizer
                </div>
                <div className="font-display text-xl text-cream leading-none mt-1">
                  Suggest improvements
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-mortar-500 hover:text-mortar-300 text-xl leading-none w-7 h-7 grid place-items-center rounded hover:bg-mortar-800"
              >✕</button>
            </div>

            {/* Total saving banner */}
            {suggestions.length > 0 && (
              <div className="px-5 py-2 bg-ns-900/40 border-b border-ns-800/40 text-xs text-ns-200">
                Apply all <strong>{suggestions.length}</strong> and save
                {' '}<strong className="text-ns-300">{totalSaving} miles</strong>
                {' '}across today's routes.
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {suggestions.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="text-4xl mb-2">✨</div>
                  <div className="text-sm font-semibold text-mortar-300 mb-1">Routes are tight</div>
                  <div className="text-[11px] text-mortar-500 max-w-xs mx-auto">
                    No reassignments would save meaningful drive time today.
                    Check back after the next sync.
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-mortar-800">
                  {suggestions.map((s, i) => {
                    const fromRep = crews.find(c => c.id === s.from_crew_id)
                    const toRep = crews.find(c => c.id === s.to_crew_id)
                    const isApplying = applyingId === s.task_id
                    return (
                      <li key={s.task_id} className="px-5 py-3">
                        <div className="flex items-start gap-3">
                          <div className="font-display text-2xl text-ns-400 w-6 text-center leading-none mt-1">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-mortar-300 truncate">
                              {s.task_name || 'Unnamed job'}
                            </div>
                            {s.task_address && (
                              <div className="text-[11px] text-mortar-500 truncate">{s.task_address}</div>
                            )}
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: fromRep?.color || '#6d675d' }}
                                />
                                <span className="text-mortar-500 line-through">{fromRep?.name || '—'}</span>
                              </div>
                              <svg className="w-3 h-3 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M5 12h14m-6-6l6 6-6 6"/>
                              </svg>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: toRep?.color || '#4a9dcf' }}
                                />
                                <span className="text-cream font-semibold">{toRep?.name || '—'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-[10px] uppercase tracking-wider text-mortar-500">Saves</div>
                            <div className="font-display text-lg text-emerald-400 leading-none">
                              {s.miles_saved}mi
                            </div>
                            <div className="text-[10px] text-mortar-500 mt-0.5">
                              {s.minutes_saved}m
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDismiss(s.task_id)}
                            disabled={isApplying}
                            className="text-[11px] px-2.5 py-1 rounded border border-mortar-700 text-mortar-500 hover:text-mortar-300 hover:border-mortar-500 disabled:opacity-40"
                          >
                            Skip
                          </button>
                          <button
                            onClick={() => handleApply(s)}
                            disabled={isApplying}
                            className="text-[11px] font-semibold px-3 py-1 rounded bg-ns-500 hover:bg-ns-400 text-white disabled:opacity-50"
                          >
                            {isApplying ? 'Applying…' : 'Apply'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="px-5 py-2 bg-mortar-950 border-t border-mortar-800 text-[10px] text-mortar-500 text-center">
              Based on home-base → stops → home distance. Only reps with a home base are considered.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
