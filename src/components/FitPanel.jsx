import { useState, useRef } from 'react'
import { suggestSlots } from '../lib/data'

export default function FitPanel({ crews, onResult, currentResult, onClear, onFlash }) {
  const [address, setAddress] = useState('')
  const [duration, setDuration] = useState(2)
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  const handleSearch = async (e) => {
    e?.preventDefault?.()
    if (!address.trim() || searching) return
    setSearching(true)
    try {
      const r = await suggestSlots({ address: address.trim(), duration_hrs: duration })
      if (!r?.lat) {
        onFlash?.('Could not find that address', 'error')
        return
      }
      onResult?.(r)
      setOpen(true)
    } catch (err) {
      onFlash?.(`Fit search failed: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  const handleClear = () => {
    setAddress('')
    setOpen(false)
    onClear?.()
    inputRef.current?.focus()
  }

  const suggestions = currentResult?.suggestions || []

  return (
    <div className="border-t border-mortar-800 bg-mortar-900/80 relative">
      {/* Input bar */}
      <form onSubmit={handleSearch} className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <svg className="w-4 h-4 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Fit a lead — paste address to find the 5 best slots in the next 4 days"
            className="flex-1 min-w-0 bg-mortar-950 border border-mortar-800 rounded px-3 py-1.5 text-xs text-mortar-300 placeholder:text-mortar-500 focus:outline-none focus:border-ns-400"
          />
          <div className="flex items-center gap-1 text-[10px] text-mortar-500">
            <span className="uppercase tracking-wider">hrs</span>
            <select
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="bg-mortar-950 border border-mortar-800 rounded px-1.5 py-1 text-xs text-mortar-300 focus:outline-none focus:border-ns-400"
            >
              {[1, 2, 3, 4, 6, 8].map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={!address.trim() || searching}
          className="px-3 py-1.5 text-xs rounded bg-ns-500 hover:bg-ns-400 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {searching ? 'Finding…' : 'Find slots'}
        </button>
        {currentResult && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 py-1.5 text-xs rounded border border-mortar-700 text-mortar-500 hover:text-mortar-300 hover:border-mortar-500"
            title="Clear"
          >✕</button>
        )}
      </form>

      {/* Results drawer */}
      {open && currentResult && (
        <div className="absolute bottom-full left-0 right-0 bg-mortar-900 border-t border-ns-800 shadow-[0_-8px_24px_rgba(0,0,0,0.4)] max-h-[50vh] overflow-y-auto z-20">
          <div className="px-3 py-2 border-b border-mortar-800 flex items-center justify-between sticky top-0 bg-mortar-900">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ns-400">Recommended slots</div>
              <div className="text-xs text-mortar-300 truncate max-w-md">{currentResult.address}</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-mortar-500 hover:text-mortar-300 text-xs"
            >Hide</button>
          </div>
          {suggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-mortar-500">
              No good fits in the next 4 days — every rep's route is full or too far.
            </div>
          ) : (
            <ul className="divide-y divide-mortar-800">
              {suggestions.map((s, i) => {
                const rep = crews.find(c => c.id === s.rep_id)
                return (
                  <li key={i} className="px-3 py-2.5 flex items-center gap-3 hover:bg-mortar-800/50 transition">
                    <div className="font-display text-2xl text-ns-400 w-6 text-center">{i + 1}</div>
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: rep?.color || '#4a9dcf' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-mortar-300 truncate">
                        {rep?.name || s.rep_id}
                      </div>
                      <div className="text-[11px] text-mortar-500 truncate">
                        {s.day_label} · {s.insert_label} · +{s.added_miles}mi / +{s.added_drive_min}m drive
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-mortar-500">Fit score</div>
                      <div className="text-lg font-bold text-ns-300 leading-none">{s.score}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="px-3 py-1.5 border-t border-mortar-800 text-[10px] text-mortar-500 text-center bg-mortar-950">
            Lower added drive time = higher fit score. Click a rep on the left to see their route.
          </div>
        </div>
      )}
    </div>
  )
}
