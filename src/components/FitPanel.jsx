import { useState, useRef, useEffect, useCallback } from 'react'
import { suggestSlotsAt } from '../lib/data'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_ENDPOINT = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

// Bias results to NSM's four metro areas (Chicago, Milwaukee, Dallas, Indianapolis)
// proximity is a single point — Chicago is the center of gravity for NSM
const PROXIMITY = '-87.6298,41.8781'

// Debounce helper
function useDebouncedValue(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

async function mapboxSuggest(query) {
  if (!MAPBOX_TOKEN) return []
  const url = `${MAPBOX_ENDPOINT}/${encodeURIComponent(query)}.json`
    + `?access_token=${MAPBOX_TOKEN}`
    + `&autocomplete=true`
    + `&country=us`
    + `&limit=5`
    + `&proximity=${PROXIMITY}`
    + `&types=address,poi`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Mapbox ${r.status}`)
  const data = await r.json()
  return (data.features || []).map(f => ({
    id: f.id,
    address: f.place_name,
    shortAddress: f.text + (f.address ? ` ${f.address}` : ''),
    context: (f.context || []).map(c => c.text).slice(0, 3).join(', '),
    lat: f.center[1],
    lng: f.center[0],
  }))
}

export default function FitPanel({ crews, onResult, currentResult, onClear, onFlash }) {
  const [query, setQuery] = useState('')
  const [duration, setDuration] = useState(2)
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  const debounced = useDebouncedValue(query, 220)

  // Fetch Mapbox suggestions when debounced query changes
  useEffect(() => {
    let cancelled = false
    if (!debounced || debounced.trim().length < 3) {
      setSuggestions([])
      setDropdownOpen(false)
      return
    }
    mapboxSuggest(debounced.trim())
      .then(results => {
        if (cancelled) return
        setSuggestions(results)
        setDropdownOpen(results.length > 0)
        setActiveIdx(-1)
      })
      .catch(() => {
        if (cancelled) return
        setSuggestions([])
        setDropdownOpen(false)
      })
    return () => { cancelled = true }
  }, [debounced])

  // Close dropdown when clicking outside
  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const runSearch = useCallback(async (picked) => {
    if (!picked) return
    setSearching(true)
    setDropdownOpen(false)
    try {
      const r = await suggestSlotsAt({
        address: picked.address,
        lat: picked.lat,
        lng: picked.lng,
        duration_hrs: duration,
      })
      if (!r?.lat) {
        onFlash?.('Could not find that address', 'error')
        return
      }
      onResult?.(r)
      setResultsOpen(true)
      setQuery(picked.address)
    } catch (err) {
      onFlash?.(`Fit search failed: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }, [duration, onFlash, onResult])

  const handleKeyDown = (e) => {
    if (!dropdownOpen || suggestions.length === 0) {
      if (e.key === 'Enter' && query.trim().length >= 3) {
        e.preventDefault()
        runSearch({ address: query.trim(), lat: null, lng: null })
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = activeIdx >= 0 ? suggestions[activeIdx] : suggestions[0]
      runSearch(pick)
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  const handleClear = () => {
    setQuery('')
    setSuggestions([])
    setDropdownOpen(false)
    setResultsOpen(false)
    onClear?.()
    inputRef.current?.focus()
  }

  const fitSuggestions = currentResult?.suggestions || []

  return (
    <div className="border-t border-mortar-800 bg-mortar-900/80 relative" ref={wrapRef}>
      {/* Autocomplete dropdown */}
      {dropdownOpen && suggestions.length > 0 && (
        <div className="autocomplete-dropdown">
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              className={`autocomplete-item ${i === activeIdx ? 'active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => runSearch(s)}
            >
              <svg className="w-3.5 h-3.5 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <div className="flex-1 min-w-0">
                <div className="ac-main truncate">{s.shortAddress || s.address.split(',')[0]}</div>
                <div className="ac-secondary truncate">{s.context || s.address}</div>
              </div>
            </div>
          ))}
          <div className="autocomplete-attribution">Powered by Mapbox</div>
        </div>
      )}

      {/* Input bar */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0 relative">
          <svg className="w-4 h-4 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setResultsOpen(false) }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (suggestions.length) setDropdownOpen(true) }}
            placeholder="Fit a lead — start typing an address to find the 5 best slots in the next 4 days"
            className="flex-1 min-w-0 bg-mortar-950 border border-mortar-800 rounded px-3 py-1.5 text-xs text-mortar-300 placeholder:text-mortar-500 focus:outline-none focus:border-ns-400"
            autoComplete="off"
            spellCheck={false}
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
        {searching && <span className="text-[10px] text-mortar-500">Finding…</span>}
        {currentResult && !searching && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2 py-1.5 text-xs rounded border border-mortar-700 text-mortar-500 hover:text-mortar-300 hover:border-mortar-500"
            title="Clear"
          >✕</button>
        )}
      </div>

      {/* Results drawer */}
      {resultsOpen && currentResult && (
        <div className="absolute bottom-full left-0 right-0 bg-mortar-900 border-t border-ns-800 shadow-[0_-8px_24px_rgba(0,0,0,0.4)] max-h-[50vh] overflow-y-auto z-20">
          <div className="px-3 py-2 border-b border-mortar-800 flex items-center justify-between sticky top-0 bg-mortar-900">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ns-400">Recommended slots</div>
              <div className="text-xs text-mortar-300 truncate max-w-md">{currentResult.address}</div>
            </div>
            <button
              onClick={() => setResultsOpen(false)}
              className="text-mortar-500 hover:text-mortar-300 text-xs"
            >Hide</button>
          </div>
          {fitSuggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-mortar-500">
              No good fits in the next 4 days — every rep's route is full or too far.
            </div>
          ) : (
            <ul className="divide-y divide-mortar-800">
              {fitSuggestions.map((s, i) => {
                const rep = crews.find(c => c.id === s.rep_id)
                return (
                  <li key={i} className="px-3 py-2.5 flex items-center gap-3 hover:bg-mortar-800/50 transition">
                    <div className="font-display text-2xl text-ns-400 w-6 text-center">{i + 1}</div>
                    {rep?.avatar_url ? (
                      <img
                        src={rep.avatar_url}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                        style={{ boxShadow: `0 0 0 1.5px ${rep.color}` }}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: rep?.color || '#4a9dcf' }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-mortar-300 truncate">
                        {rep?.name || s.rep_id}
                      </div>
                      <div className="text-[11px] text-mortar-500 truncate">
                        {s.day_label} · {s.insert_label} · +{s.added_miles}mi / +{s.added_drive_min}m drive
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-mortar-500">Fit</div>
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
