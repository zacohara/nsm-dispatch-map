import { useMemo, useState } from 'react'
import { recommendSwaps } from '../lib/recommender'

export default function OptimizeModal({ open, onClose, crews, tasks, onApplySwap }) {
  const [applying, setApplying] = useState(null)

  const suggestions = useMemo(() => {
    if (!open) return []
    return recommendSwaps(crews, tasks).slice(0, 12)
  }, [open, crews, tasks])

  if (!open) return null

  const totalMiles = suggestions.reduce((a, b) => a + b.miles_saved, 0)
  const totalMin = suggestions.reduce((a, b) => a + b.minutes_saved, 0)

  const applyOne = async (s) => {
    setApplying(s.task_id)
    try { await onApplySwap(s.task_id, s.to_crew_id) } catch (e) { /* parent toasts */ }
    setApplying(null)
  }

  const applyAll = async () => {
    for (const s of suggestions) {
      setApplying(s.task_id)
      try { await onApplySwap(s.task_id, s.to_crew_id) } catch (e) { break }
    }
    setApplying(null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-mortar-900 border border-mortar-800 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-mortar-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-mortar-300">Optimize day</div>
            <div className="text-xs text-mortar-500">
              {suggestions.length > 0
                ? `${suggestions.length} suggested swap${suggestions.length === 1 ? '' : 's'} · save ~${totalMiles}mi / ${totalMin}min`
                : 'No swaps found — day looks tight already'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-mortar-500 hover:text-mortar-300 text-xl leading-none px-2"
          >×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {suggestions.length === 0 && (
            <div className="text-center py-8 text-mortar-500 text-sm">
              Nothing obvious to swap. Pin layouts on the map look efficient.
            </div>
          )}
          {suggestions.map(s => (
            <div
              key={s.task_id}
              className="border border-mortar-800 rounded-lg p-3 bg-mortar-950/50 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-mortar-300 truncate">{s.task_name}</div>
                <div className="text-[11px] text-mortar-500 flex items-center gap-2 mt-1">
                  <span>{s.from_crew_name}</span>
                  <span className="text-brick-500">→</span>
                  <span className="text-mortar-300">{s.to_crew_name}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-emerald-400 text-sm font-bold">−{s.miles_saved}mi</div>
                <div className="text-[10px] text-mortar-500">−{s.minutes_saved}min</div>
              </div>
              <button
                onClick={() => applyOne(s)}
                disabled={applying != null}
                className="px-3 py-1.5 text-xs rounded border border-brick-600 text-brick-500 hover:bg-brick-600 hover:text-white disabled:opacity-40"
              >
                {applying === s.task_id ? '…' : 'Apply'}
              </button>
            </div>
          ))}
        </div>

        {suggestions.length > 0 && (
          <div className="px-4 py-3 border-t border-mortar-800 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-mortar-800 text-mortar-300 hover:bg-mortar-800"
            >
              Cancel
            </button>
            <button
              onClick={applyAll}
              disabled={applying != null}
              className="px-3 py-1.5 text-xs rounded bg-brick-600 hover:bg-brick-700 text-white font-semibold disabled:opacity-40"
            >
              Apply all {suggestions.length}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
