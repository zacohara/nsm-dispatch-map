import { useState, useRef, useEffect, useCallback } from 'react'
import { suggestSlotsAt } from '../lib/data'
import { sortReps } from '../lib/utils'

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
  const [duration, setDuration] = useState(1)
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState(-1)
  // Centered search modal — replaces the old inline rep-chip strip + input bar.
  // Always closed on first paint; opens when the user clicks "Search address"
  // and closes on ESC, backdrop click, successful search, or the X button.
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  // Rep filter. null = include all active reps (the default on every reload).
  // A Set of rep ids means "only these". Not persisted — resets on reload.
  const [includedRepIds, setIncludedRepIds] = useState(null)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  const activeCrews = sortReps(crews.filter(c => c.active !== false))
  const allSelected = includedRepIds === null
  const isRepIncluded = (id) => allSelected || includedRepIds.has(id)
  const toggleRep = (id) => {
    setIncludedRepIds(prev => {
      if (prev === null) {
        // Was "all" — turning one off means "all except this one"
        const next = new Set(activeCrews.map(c => c.id))
        next.delete(id)
        return next
      }
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // If they re-selected everyone, collapse back to null ("all")
      if (next.size === activeCrews.length) return null
      return next
    })
  }
  const toggleAll = () => {
    setIncludedRepIds(prev => (prev === null ? new Set() : null))
  }

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

  // Search modal: ESC closes; body scroll is locked while open so the
  // background dispatch map doesn't scroll under the user. Auto-focus on
  // the address input is handled inline via autoFocus.
  useEffect(() => {
    if (!searchModalOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setSearchModalOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [searchModalOpen])

  const runSearch = useCallback(async (picked) => {
    if (!picked) return
    if (includedRepIds !== null && includedRepIds.size === 0) {
      onFlash?.('Select at least one rep to search', 'error')
      return
    }
    setSearching(true)
    setDropdownOpen(false)
    try {
      // When the user has narrowed to a specific rep set, auto-engage
      // lock-per-rep mode so they see each chosen rep's openings across
      // the 5-day window instead of just the single best (rep, day) overall.
      const lockPerRep = includedRepIds !== null && includedRepIds.size > 0
      const r = await suggestSlotsAt({
        address: picked.address,
        lat: picked.lat,
        lng: picked.lng,
        duration_hrs: duration,
        rep_ids: includedRepIds === null ? null : Array.from(includedRepIds),
        lock_per_rep: lockPerRep,
      })
      if (!r?.lat) {
        onFlash?.('Could not find that address', 'error')
        return
      }
      onResult?.(r)          // → parent sets currentResult → isLocked becomes true
      setResultsOpen(true)
      setSearchModalOpen(false)
      // Don't write the address back to query — we'll render a pill instead
      setQuery('')
      setSuggestions([])
      onSelectRep?.(null)
    } catch (err) {
      onFlash?.(`Fit search failed: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }, [duration, onFlash, onResult, onSelectRep, includedRepIds])

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
  const isLockMode = Boolean(currentResult?.lock_per_rep)
  const driveSource = currentResult?.drive_source

  // In lock mode, group suggestions by rep so we can render rep-section headers
  // with the rep's avatar, name, and tier — followed by their per-day slots.
  // In default mode this stays a flat list.
  const groupedByRep = (() => {
    if (!isLockMode) return null
    const groups = new Map()
    fitSuggestions.forEach(s => {
      if (!groups.has(s.rep_id)) groups.set(s.rep_id, [])
      groups.get(s.rep_id).push(s)
    })
    return Array.from(groups.entries()).map(([repId, slots]) => ({
      rep: crews.find(c => c.id === repId),
      slots,
    }))
  })()

  // Short display for the locked address
  const lockedAddressShort = currentResult?.address?.split(',').slice(0, 2).join(',')

  return (
    <div className="border-t border-mortar-800 bg-mortar-900/95 relative" ref={wrapRef}>
      {/* ── Bottom trigger bar ────────────────────────────────────
          Replaces the old always-visible rep-chip strip + input. When no
          search is active, shows a single centered "Search address" button.
          When a result is locked, shows the locked-address pill + new
          address / show slots actions. The actual search UI lives in a
          centered modal that opens on demand. */}
      <div className="px-3 py-2 flex items-center justify-center gap-2 min-h-[44px]">
        {isLocked ? (
          <div className="flex items-center gap-2 flex-1 min-w-0 max-w-3xl">
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-ns-900/40 border border-ns-700 rounded px-3 py-1.5">
              <svg className="w-4 h-4 text-ns-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              <span className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display flex-shrink-0">Fit lead</span>
              <span className="text-xs text-cream font-semibold truncate">{lockedAddressShort}</span>
              <span className="text-[10px] text-mortar-500 flex-shrink-0 hidden sm:inline">
                · {duration}hr · {currentResult?.lock_per_rep ? `${groupedByRep?.length || 0} reps locked` : 'all reps'}
              </span>
            </div>
            {!resultsOpen && fitSuggestions.length > 0 && (
              <button
                type="button"
                onClick={() => setResultsOpen(true)}
                className="px-3 py-1.5 text-[11px] rounded bg-ns-500 hover:bg-ns-400 text-white font-semibold flex-shrink-0"
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
              <span className="hidden sm:inline">New address</span>
              <span>✕</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="flex items-center gap-2.5 px-5 py-2 rounded-lg bg-ns-500 hover:bg-ns-400 text-white font-semibold text-sm shadow-lg transition border border-ns-300"
            title="Find the best rep for a lead address"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span>Search address</span>
            <span className="text-[10px] uppercase tracking-wider opacity-75 font-normal hidden sm:inline">— find best rep</span>
          </button>
        )}
      </div>

      {/* ── Search modal ─────────────────────────────────────────
          Centered overlay with everything needed to fit a lead: address
          autocomplete, duration, "All reps" toggle, multi-select rep grid.
          Opens via the button above; closes on backdrop click, ESC, X, or
          successful search. Uses the same handlers as the old inline UI
          (runSearch, suggestions, includedRepIds) — only the chrome moved. */}
      {searchModalOpen && !isLocked && (
        <div
          className="fixed inset-0 z-[3200] bg-black/70 backdrop-blur-sm grid place-items-center p-4"
          onClick={() => setSearchModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setSearchModalOpen(false)}
          tabIndex={-1}
        >
          <div
            className="w-full max-w-xl bg-mortar-900 rounded-xl border border-mortar-800 shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-3 brick-texture border-b border-mortar-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display">
                  Fit a lead
                </div>
                <div className="font-display text-xl text-cream leading-none mt-1">
                  Search address
                </div>
              </div>
              <button
                onClick={() => setSearchModalOpen(false)}
                className="text-mortar-500 hover:text-mortar-300 text-xl leading-none w-7 h-7 grid place-items-center rounded hover:bg-mortar-800"
                title="Close (ESC)"
              >✕</button>
            </div>

            {/* Address input + duration */}
            <div className="px-5 py-4 border-b border-mortar-800 relative">
              <label className="block text-[10px] uppercase tracking-wider text-mortar-500 mb-1.5">
                Lead address
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 relative">
                  <div className="flex items-center gap-2 bg-mortar-950 border border-mortar-700 rounded px-3 py-2 focus-within:border-ns-400">
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
                      placeholder="Start typing an address…"
                      className="flex-1 min-w-0 bg-transparent text-sm text-cream placeholder:text-mortar-500 focus:outline-none"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                    />
                    {searching && <span className="text-[10px] text-mortar-500 flex-shrink-0">Finding…</span>}
                  </div>
                  {/* Autocomplete dropdown — anchored under the input INSIDE the modal */}
                  {dropdownOpen && suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-mortar-900 border border-mortar-700 rounded shadow-xl z-10 max-h-64 overflow-y-auto">
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
                </div>
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <label className="text-[9px] uppercase tracking-wider text-mortar-500">Hours</label>
                  <select
                    value={duration}
                    onChange={e => setDuration(Number(e.target.value))}
                    className="bg-mortar-950 border border-mortar-700 rounded px-2 py-2 text-sm text-cream focus:outline-none focus:border-ns-400"
                  >
                    {[1, 2, 3, 4, 6, 8].map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Rep selector — "All reps" toggle + multi-select grid */}
            {activeCrews.length > 0 && (
              <div className="px-5 py-4 border-b border-mortar-800 max-h-[40vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] uppercase tracking-wider text-mortar-500">
                    Reps to consider
                  </label>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className={[
                      'flex items-center gap-2 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider border transition',
                      allSelected
                        ? 'bg-ns-500 border-ns-400 text-white'
                        : 'bg-mortar-950 border-mortar-700 text-mortar-300 hover:border-ns-500',
                    ].join(' ')}
                    title={allSelected
                      ? 'Click to deselect all and pick reps individually'
                      : 'Click to include every active rep'}
                  >
                    <span
                      className={[
                        'w-7 h-3.5 rounded-full relative transition flex-shrink-0',
                        allSelected ? 'bg-white/30' : 'bg-mortar-700',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all',
                          allSelected ? 'left-3.5' : 'left-0.5',
                        ].join(' ')}
                      />
                    </span>
                    {allSelected ? 'All reps' : `${includedRepIds?.size || 0} selected`}
                  </button>
                </div>
                {!allSelected && (
                  <div className="text-[10px] text-mortar-500 mb-2">
                    Each selected rep's best opening per day will be returned.
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {activeCrews.map(c => {
                    const on = isRepIncluded(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleRep(c.id)}
                        className={[
                          'flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium border transition text-left',
                          on
                            ? 'text-white'
                            : 'bg-mortar-950 border-mortar-800 text-mortar-400 hover:border-mortar-600',
                        ].join(' ')}
                        style={on ? { background: c.color, borderColor: c.color } : undefined}
                        title={on ? `Click to exclude ${c.name}` : `Click to include ${c.name}`}
                      >
                        {c.avatar_url ? (
                          <img
                            src={c.avatar_url}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span
                            className="w-4 h-4 rounded-full flex-shrink-0 grid place-items-center text-[8px] font-bold text-white"
                            style={{ background: on ? 'rgba(255,255,255,0.25)' : c.color }}
                          >
                            {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="truncate">{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Footer with primary action */}
            <div className="px-5 py-3 bg-mortar-950/40 flex items-center justify-between gap-2">
              <div className="text-[10px] text-mortar-500">
                {query.length < 3 ? 'Type at least 3 characters, then pick from the list' :
                 suggestions.length > 0 ? `${suggestions.length} match${suggestions.length === 1 ? '' : 'es'} — click one to search` :
                 'Keep typing or refine the address'}
              </div>
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-mortar-700 text-mortar-400 hover:text-mortar-200 hover:border-mortar-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results drawer */}
      {resultsOpen && currentResult && (
        <div className="absolute bottom-full left-0 right-0 bg-mortar-900 border-t border-ns-600 shadow-[0_-8px_24px_rgba(0,0,0,0.5)] max-h-[40vh] overflow-y-auto z-20">
          <div className="px-3 py-2 border-b border-mortar-800 flex items-center justify-between sticky top-0 bg-mortar-900 z-10">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wider text-ns-400 font-display">
                  {isLockMode ? `Locked to ${groupedByRep?.length || 0} rep${groupedByRep?.length === 1 ? '' : 's'}` : 'Recommended slots'}
                </div>
                {driveSource === 'mapbox' && (
                  <span
                    className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40"
                    title="Detour calculated from real driving routes via Mapbox"
                  >
                    Live drive time
                  </span>
                )}
              </div>
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
              {isLockMode
                ? 'No openings for the locked rep(s) in the next 5 days — try widening the rep filter.'
                : "No good fits in the next 5 days — every rep's route is full or too far."}
            </div>
          ) : isLockMode && groupedByRep ? (
            // Lock mode: rep-major grouping. One section per rep, days under each.
            <div>
              {groupedByRep.map(({ rep, slots }) => (
                <div key={rep?.id || 'unknown'} className="border-b border-mortar-800 last:border-b-0">
                  {/* Rep header */}
                  <div
                    className="px-3 py-2 flex items-center gap-2 sticky top-[52px] z-[5]"
                    style={{
                      background: `linear-gradient(90deg, ${rep?.color || '#4a9dcf'}22 0%, var(--mortar-950) 70%)`,
                      borderLeft: `3px solid ${rep?.color || '#4a9dcf'}`,
                    }}
                  >
                    {rep?.avatar_url ? (
                      <img
                        src={rep.avatar_url}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        style={{ boxShadow: `0 0 0 2px ${rep.color}` }}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div
                        className="w-6 h-6 rounded-full grid place-items-center flex-shrink-0 text-white font-bold text-[9px]"
                        style={{ background: rep?.color || '#4a9dcf' }}
                      >
                        {(rep?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs font-semibold text-cream truncate flex-1">
                      {rep?.name || 'Unknown rep'}
                    </span>
                    <span className="text-[10px] text-mortar-500 flex-shrink-0">
                      {slots.length} day{slots.length === 1 ? '' : 's'} open
                    </span>
                  </div>
                  {/* Day rows for this rep */}
                  <ul className="divide-y divide-mortar-800/60">
                    {slots.map((s) => {
                      const i = fitSuggestions.indexOf(s)
                      const isHovered = hoveredIdx === i
                      return (
                        <SlotRow
                          key={`${s.rep_id}-${s.day}-${s.insert_index}`}
                          s={s}
                          rep={rep}
                          isHovered={isHovered}
                          showRepName={false}
                          onMouseEnter={() => handleHoverSuggestion(i, s)}
                          onMouseLeave={handleUnhoverSuggestion}
                          onClick={() => handleClickSuggestion(s)}
                        />
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            // Default mode: flat top-5 list
            <ul className="divide-y divide-mortar-800">
              {fitSuggestions.map((s, i) => {
                const rep = crews.find(c => c.id === s.rep_id)
                const isHovered = hoveredIdx === i
                return (
                  <SlotRow
                    key={i}
                    s={s}
                    rep={rep}
                    rank={i + 1}
                    isHovered={isHovered}
                    showRepName={true}
                    onMouseEnter={() => handleHoverSuggestion(i, s)}
                    onMouseLeave={handleUnhoverSuggestion}
                    onClick={() => handleClickSuggestion(s)}
                  />
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

// ── SlotRow ──────────────────────────────────────────────────
// Renders a single suggestion row. Used in both default top-5 mode and the
// rep-grouped lock mode. The big change vs v0.18: a prominent leading
// DayBadge instead of a tiny inline text label.
function SlotRow({ s, rep, rank, isHovered, showRepName, onMouseEnter, onMouseLeave, onClick }) {
  return (
    <li
      className={[
        'px-3 py-2.5 transition cursor-pointer',
        isHovered ? 'bg-mortar-800' : 'hover:bg-mortar-800/60',
      ].join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <DayBadge dayLabel={s.day_label} day={s.day} repColor={rep?.color || '#4a9dcf'} />
        {showRepName && (rep?.avatar_url ? (
          <img
            src={rep.avatar_url}
            alt=""
            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
            style={{ boxShadow: `0 0 0 2px ${rep.color}` }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-7 h-7 rounded-full grid place-items-center flex-shrink-0 text-white font-bold text-[10px]"
            style={{ background: rep?.color || '#4a9dcf' }}
          >
            {(rep?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        ))}
        <div className="flex-1 min-w-0">
          {showRepName && (
            <div className="text-xs font-semibold text-mortar-200 truncate">
              {rank != null && <span className="text-ns-400 mr-1.5">#{rank}</span>}
              {rep?.name || s.rep_id}
            </div>
          )}
          <div className={showRepName ? 'mt-1' : ''}>
            <RouteChain suggestion={s} repColor={rep?.color || '#4a9dcf'} compact />
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-mortar-500">Detour</div>
          <div className="text-sm font-bold leading-none" style={{ color: s.added_miles < 2 ? '#10b981' : s.added_miles < 10 ? '#f59e0b' : '#ef4444' }}>
            +{s.added_miles}mi
          </div>
          <div className="text-[10px] text-mortar-500 mt-0.5">+{s.added_drive_min}m drive</div>
        </div>
      </div>
    </li>
  )
}

// ── DayBadge ─────────────────────────────────────────────────
// Big visual day chip at the leading edge of each suggestion row. Two-line:
// abbreviated weekday on top, day-of-month underneath. Special highlight for
// Today/Tomorrow. Replaces the tiny text "Today" label that was easy to miss.
function DayBadge({ dayLabel, day, repColor }) {
  // Parse the ISO date for the bottom line
  const d = day ? new Date(day + 'T12:00:00') : null
  const isToday = dayLabel === 'Today'
  const isTomorrow = dayLabel === 'Tomorrow'

  // Top line: weekday short ("Mon", "Tue"...) — for Today/Tomorrow we override
  const top = isToday ? 'TDY' : isTomorrow ? 'TMR' : (d ? d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : '—')
  // Bottom line: day-of-month
  const bottom = d ? d.getDate() : '—'

  // Color treatment: today gets the rep color filled in, tomorrow gets a
  // lighter version, future days get a subtle outline. Keeps "act now" visually loud.
  const fillColor = isToday ? repColor : 'transparent'
  const textColor = isToday ? '#ffffff' : isTomorrow ? repColor : '#cbd5e0'
  const borderColor = isToday ? repColor : isTomorrow ? repColor : '#3a4452'

  return (
    <div
      className="flex flex-col items-center justify-center flex-shrink-0 rounded-md font-display"
      style={{
        width: 42,
        height: 42,
        background: fillColor,
        border: `1.5px solid ${borderColor}`,
        boxShadow: isToday ? `0 0 0 2px ${repColor}33, 0 2px 6px rgba(0,0,0,0.4)` : 'none',
      }}
    >
      <span
        className="text-[8px] font-bold tracking-[0.1em] leading-none"
        style={{ color: isToday ? 'rgba(255,255,255,0.9)' : textColor }}
      >
        {top}
      </span>
      <span
        className="text-base font-extrabold leading-none mt-0.5"
        style={{ color: textColor }}
      >
        {bottom}
      </span>
    </div>
  )
}
