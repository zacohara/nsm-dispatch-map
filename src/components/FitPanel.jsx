import { useState, useRef, useEffect, useCallback } from 'react'
import { suggestSlotsAt } from '../lib/data'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_ENDPOINT = 'https://api.mapbox.com/geocoding/v5/mapbox.places'
const PROXIMITY = '-87.6298,41.8781'

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
    + `&autocomplete=true&country=us&limit=5`
    + `&proximity=${PROXIMITY}&types=address,poi`
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

// Compact route chain: 🏠 ① ② NEW ③ 🏠
function RouteChain({ suggestion, repColor, compact }) {
  const stops = suggestion.day_stops || []
  const insertIdx = suggestion.insert_index ?? stops.length
  const dotSize = compact ? 8 : 11
  const newSize = compact ? 14 : 18
  const lineLen = compact ? 4 : 6

  const items = []
  items.push({ type: 'home' })
  for (let i = 0; i < stops.length; i++) {
    if (i === insertIdx) items.push({ type: 'new', label: 'NEW' })
    items.push({ type: 'stop', label: String(i + 1) })
  }
  if (insertIdx >= stops.length) items.push({ type: 'new', label: 'NEW' })
  items.push({ type: 'home' })

  return (
    <div className="flex items-center flex-wrap gap-0">
      {items.map((it, i) => (
        <span key={i} className="flex items-center">
          {it.type === 'home' && (
            <span
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{ fontSize: compact ? 10 : 12, width: dotSize + 4, height: dotSize + 4 }}
              title="Home"
            >🏠</span>
          )}
          {it.type === 'stop' && (
            <span
              className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-white font-bold"
              style={{ width: dotSize, height: dotSize, background: repColor, fontSize: compact ? 7 : 8 }}
            >{it.label}</span>
          )}
          {it.type === 'new' && (
            <span
              className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-white font-display font-bold"
              style={{
                width: newSize, height: newSize,
                background: '#4a9dcf',
                fontSize: compact ? 7 : 9,
                letterSpacing: '0.02em',
                boxShadow: '0 0 0 1.5px #4a9dcf33, 0 1px 3px rgba(0,0,0,0.4)',
              }}
            >{it.label}</span>
          )}
          {i < items.length - 1 && (
            <span
              className="inline-block flex-shrink-0"
              style={{
                width: lineLen, height: 1,
                background: items[i].type === 'new' || items[i + 1].type === 'new'
                  ? '#4a9dcf' : `${repColor}66`,
              }}
            />
          )}
        </span>
      ))}
    </div>
  )
}

export default function FitPanel({
  crews,
  onResult,
  currentResult,
  onClear,
  onFlash,
  onPreviewSuggestion,
  onSelectRep,
}) {
  const [query, setQuery] = useState('')
  const [duration, setDuration] = useState(2)
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  // When a result is locked in, the input gets replaced with a pill showing
  // the selected address. The typing path is disabled entirely until clear.
  const isLocked = Boolean(currentResult)

  const debounced = useDebouncedValue(query, 220)

  // Mapbox suggestions — ONLY while NOT locked
  useEffect(() => {
    if (isLocked) {
      setSuggestions([])
      setDropdownOpen(false)
      return
    }
    let cancelled = false
    if (!debounced || debounced.trim().length < 3) {
      setSuggestions([]); setDropdownOpen(false); return
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
        setSuggestions([]); setDropdownOpen(false)
      })
    return () => { cancelled = true }
  }, [debounced, isLocked])

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (!resultsOpen) {
      setHoveredIdx(-1)
      onPreviewSuggestion?.(null)
    }
  }, [resultsOpen, onPreviewSuggestion])

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
      onResult?.(r)          // → parent sets currentResult → isLocked becomes true
      setResultsOpen(true)
      // Don't write the address back to query — we'll render a pill instead
      setQuery('')
      setSuggestions([])
      onSelectRep?.(null)
    } catch (err) {
      onFlash?.(`Fit search failed: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }, [duration, onFlash, onResult, onSelectRep])

  const handleKeyDown = (e) => {
    if (isLocked) return
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
    setHoveredIdx(-1)
    onClear?.()
    onPreviewSuggestion?.(null)
    // Give React a tick to unlock, then refocus
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleHoverSuggestion = (i, s) => {
    setHoveredIdx(i)
    onPreviewSuggestion?.(s)
  }
  const handleUnhoverSuggestion = () => {
    setHoveredIdx(-1)
    onPreviewSuggestion?.(null)
  }

  const handleClickSuggestion = (s) => {
    onPreviewSuggestion?.(null)
    onSelectRep?.(s.rep_id)
    setResultsOpen(false)
  }

  const fitSuggestions = currentResult?.suggestions || []

  // Short display for the locked address
  const lockedAddressShort = currentResult?.address?.split(',').slice(0, 2).join(',')

  return (
    <div className="border-t border-mortar-800 bg-mortar-900/80 relative" ref={wrapRef}>
      {/* Autocomplete dropdown — ONLY when not locked */}
      {!isLocked && dropdownOpen && suggestions.length > 0 && (
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

      {/* Input bar — swaps to a locked-address pill when a result is active */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        {isLocked ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-ns-900/40 border border-ns-700 rounded px-3 py-1.5">
              <svg className="w-4 h-4 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display flex-shrink-0">Fit lead</span>
              <span className="text-xs text-cream font-semibold truncate">{lockedAddressShort}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-mortar-500 flex-shrink-0">
              <span className="uppercase tracking-wider">hrs</span>
              <div className="bg-mortar-950 border border-mortar-800 rounded px-2 py-1 text-xs text-mortar-300">
                {duration}
              </div>
            </div>
            {!resultsOpen && fitSuggestions.length > 0 && (
              <button
                type="button"
                onClick={() => setResultsOpen(true)}
                className="px-2.5 py-1.5 text-[11px] rounded bg-ns-500 hover:bg-ns-400 text-white font-semibold flex-shrink-0"
              >
                Show {fitSuggestions.length} slot{fitSuggestions.length === 1 ? '' : 's'}
              </button>
            )}
            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 py-1.5 text-xs rounded border border-mortar-700 text-mortar-500 hover:text-mortar-300 hover:border-mortar-500 flex items-center gap-1 flex-shrink-0"
              title="Clear and search new address"
            >
              <span>New address</span>
              <span>✕</span>
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0 relative">
              <svg className="w-4 h-4 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (suggestions.length) setDropdownOpen(true) }}
                placeholder="Fit a lead — start typing an address to find the best rep for it"
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
          </>
        )}
      </div>

      {/* Results drawer */}
      {resultsOpen && currentResult && (
        <div className="absolute bottom-full left-0 right-0 bg-mortar-900 border-t border-ns-600 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] max-h-[40vh] overflow-y-auto z-20">
          <div className="px-3 py-2 border-b border-mortar-800 flex items-center justify-between sticky top-0 bg-mortar-900 z-10">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-ns-400 font-display">Recommended slots</div>
              <div className="text-xs text-mortar-300 truncate">{currentResult.address}</div>
            </div>
            <div className="text-[10px] text-mortar-500 mx-2">Hover to preview · Click to select</div>
            <button
              onClick={() => { setResultsOpen(false); handleUnhoverSuggestion() }}
              className="text-mortar-500 hover:text-mortar-300 text-lg leading-none w-6 h-6 grid place-items-center rounded hover:bg-mortar-800"
            >✕</button>
          </div>

          {fitSuggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-mortar-500">
              No good fits in the next 4 days — every rep's route is full or too far.
            </div>
          ) : (
            <ul className="divide-y divide-mortar-800">
              {fitSuggestions.map((s, i) => {
                const rep = crews.find(c => c.id === s.rep_id)
                const isHovered = hoveredIdx === i
                return (
                  <li
                    key={i}
                    className={[
                      'px-3 py-2.5 transition cursor-pointer',
                      isHovered ? 'bg-mortar-800' : 'hover:bg-mortar-800/60',
                    ].join(' ')}
                    onMouseEnter={() => handleHoverSuggestion(i, s)}
                    onMouseLeave={handleUnhoverSuggestion}
                    onClick={() => handleClickSuggestion(s)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-display text-2xl w-7 text-center flex-shrink-0" style={{ color: isHovered ? rep?.color : '#4a9dcf' }}>
                        {i + 1}
                      </div>
                      {rep?.avatar_url ? (
                        <img
                          src={rep.avatar_url}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          style={{ boxShadow: `0 0 0 2px ${rep.color}` }}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full grid place-items-center flex-shrink-0 text-white font-bold text-[10px]"
                          style={{ background: rep?.color || '#4a9dcf' }}
                        >
                          {(rep?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-mortar-300 truncate">
                            {rep?.name || s.rep_id}
                          </span>
                          <span className="text-[10px] text-mortar-500 flex-shrink-0">
                            {s.day_label}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <RouteChain suggestion={s} repColor={rep?.color || '#4a9dcf'} compact />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] uppercase tracking-wider text-mortar-500">Detour</div>
                        <div className="text-sm font-bold leading-none" style={{ color: s.added_miles < 2 ? '#10b981' : s.added_miles < 10 ? '#f59e0b' : '#ef4444' }}>
                          +{s.added_miles}mi
                        </div>
                        <div className="text-[10px] text-mortar-500 mt-0.5">+{s.added_drive_min}m</div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="px-3 py-1.5 border-t border-mortar-800 text-[10px] text-mortar-500 text-center bg-mortar-950">
            Green &lt; 2mi detour · amber &lt; 10mi · red &gt; 10mi. Click a row to open that rep's full day.
          </div>
        </div>
      )}
    </div>
  )
}
