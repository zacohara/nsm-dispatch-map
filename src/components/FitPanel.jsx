import { useState, useRef, useEffect, useCallback } from 'react'
import { suggestSlotsAt } from '../lib/data'
import { sortReps, dayBucket, DAY_BUCKETS } from '../lib/utils'

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
  // Day-window buckets — Set of {today, next3, later}. All on by default;
  // user clicks chips to narrow. Empty set is rejected before search fires.
  // The filter is applied client-side after the API returns — backend always
  // sends the full 14-day window, we just hide what doesn't match.
  const [selectedBuckets, setSelectedBuckets] = useState(
    () => new Set(['today', 'next3', 'later'])
  )
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

  // Suggestions returned by the backend, filtered by the user's day-window
  // selection. We keep the raw set on `currentResult.suggestions` (unchanged)
  // and derive the visible list here so toggling buckets is instant — no
  // re-fetch, no spinner, no flicker.
  const rawSuggestions = currentResult?.suggestions || []
  const fitSuggestions = rawSuggestions.filter(s => {
    const bucket = dayBucket(s.day)
    return bucket && selectedBuckets.has(bucket)
  })
  // Distribution across buckets — used to show counts on the filter chips
  // and to disable buckets that have no slots (e.g. "4+ days" when window
  // returned no later results).
  const bucketCounts = (() => {
    const c = { today: 0, next3: 0, later: 0 }
    for (const s of rawSuggestions) {
      const b = dayBucket(s.day)
      if (b) c[b]++
    }
    return c
  })()
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

            {/* When window — three toggleable buckets covering today / next 3 /
                4+ days out. All on by default. Clicking a chip toggles it. At
                least one must be selected (we block empty-set submission). */}
            <div className="px-5 py-4 border-b border-mortar-800">
              <label className="block text-[10px] uppercase tracking-wider text-mortar-500 mb-2">
                When
              </label>
              <div className="flex items-center gap-2">
                {['today', 'next3', 'later'].map(key => {
                  const meta = DAY_BUCKETS[key]
                  const on = selectedBuckets.has(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedBuckets(prev => {
                          const next = new Set(prev)
                          if (next.has(key)) {
                            // Don't allow zeroing out — at least one window stays on.
                            if (next.size === 1) return prev
                            next.delete(key)
                          } else {
                            next.add(key)
                          }
                          return next
                        })
                      }}
                      className={[
                        'flex-1 px-3 py-2 rounded-md text-[11px] font-semibold uppercase tracking-wider border transition',
                        on
                          ? 'bg-ns-500 border-ns-300 text-white shadow-md shadow-ns-900/40'
                          : 'bg-mortar-950 border-mortar-800 text-mortar-500 hover:border-mortar-600 hover:text-mortar-300',
                      ].join(' ')}
                      title={`Show ${meta.label}`}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>{meta.short}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="mt-1.5 text-[10px] text-mortar-500">
                Tap to toggle. Results across selected windows are merged.
              </div>
            </div>
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

            {/* Footer with primary action — explicit Search button so the
                modal isn't autocomplete-only. If the user types a custom
                address that doesn't match any suggestion (rare addresses,
                P.O. boxes, sketchy autocomplete data), this lets them
                still submit. Pressing Enter in the input does the same. */}
            <div className="px-5 py-3 bg-mortar-950/40 flex items-center justify-between gap-2">
              <div className="text-[10px] text-mortar-500 flex-1 min-w-0">
                {query.length < 3 ? 'Type at least 3 characters · pick a suggestion or hit Search' :
                 suggestions.length > 0 ? `${suggestions.length} match${suggestions.length === 1 ? '' : 'es'} — click one or hit Search` :
                 'No matches in autocomplete — Search will look up the typed address directly'}
              </div>
              <button
                type="button"
                onClick={() => setSearchModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-mortar-700 text-mortar-400 hover:text-mortar-200 hover:border-mortar-500 flex-shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={query.trim().length < 3 || searching}
                onClick={() => {
                  // Prefer the highlighted/first autocomplete pick if any
                  // suggestions are loaded (that gives us pre-resolved
                  // lat/lng for free); otherwise submit the raw typed
                  // address — backend will geocode via Nominatim.
                  if (suggestions.length > 0) {
                    runSearch(activeIdx >= 0 ? suggestions[activeIdx] : suggestions[0])
                  } else {
                    runSearch({ address: query.trim(), lat: null, lng: null })
                  }
                }}
                className={[
                  'px-4 py-1.5 text-xs font-semibold rounded border flex items-center gap-1.5 transition flex-shrink-0',
                  query.trim().length >= 3 && !searching
                    ? 'bg-ns-500 hover:bg-ns-400 border-ns-300 text-white shadow-md shadow-ns-900/40'
                    : 'bg-mortar-900 border-mortar-800 text-mortar-600 cursor-not-allowed',
                ].join(' ')}
              >
                {searching ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                    </svg>
                    Search
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results drawer */}
      {resultsOpen && currentResult && (
        <div className="absolute bottom-full left-0 right-0 bg-mortar-900 border-t border-ns-600 shadow-[0_-12px_40px_rgba(0,0,0,0.6)] max-h-[38vh] overflow-y-auto z-[1000]">
          {/* ── Banner ────────────────────────────────────────
              The honest answer to "what is on my screen right now."
              Shows the address being fit (hero), the day window being
              shown, and the duration. No more guessing what 'Recommended
              for 3738 N...' means. */}
          <div className="px-4 py-3 brick-texture border-b border-mortar-800 sticky top-0 z-10 bg-mortar-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display">
                    Fit a lead
                  </div>
                  {driveSource === 'mapbox' && (
                    <span
                      className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 leading-none"
                      title="Detour calculated from real driving routes via Mapbox"
                    >
                      Live drive time
                    </span>
                  )}
                </div>
                <div className="font-display text-base sm:text-lg text-cream font-bold leading-tight truncate" title={currentResult.address}>
                  {currentResult.address}
                </div>
                <div className="text-[11px] text-mortar-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-mortar-300">
                    {fitSuggestions.length} fit{fitSuggestions.length === 1 ? '' : 's'} found
                  </span>
                  <span className="text-mortar-600">·</span>
                  <span>{duration}hr appointment</span>
                  <span className="text-mortar-600">·</span>
                  <span>
                    {selectedBuckets.size === 3
                      ? 'next 14 days'
                      : Array.from(selectedBuckets).map(k => DAY_BUCKETS[k].label.toLowerCase()).join(' + ')}
                  </span>
                  {isLockMode && (
                    <>
                      <span className="text-mortar-600">·</span>
                      <span className="text-ns-300">{groupedByRep?.length || 0} reps locked</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setResultsOpen(false); handleUnhoverSuggestion() }}
                className="text-mortar-500 hover:text-mortar-200 text-xl leading-none w-7 h-7 grid place-items-center rounded hover:bg-mortar-800 flex-shrink-0"
                title="Close (keeps your search — reopen via 'Show slots')"
              >✕</button>
            </div>
            {/* Inline bucket toggles — re-filter without reopening modal */}
            <div className="flex items-center gap-1.5 mt-2.5">
              <span className="text-[9px] uppercase tracking-wider text-mortar-500 mr-1">Window:</span>
              {['today', 'next3', 'later'].map(key => {
                const meta = DAY_BUCKETS[key]
                const on = selectedBuckets.has(key)
                const count = bucketCounts[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedBuckets(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) {
                          if (next.size === 1) return prev
                          next.delete(key)
                        } else {
                          next.add(key)
                        }
                        return next
                      })
                    }}
                    disabled={count === 0 && !on}
                    className={[
                      'px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition flex items-center gap-1.5',
                      on
                        ? 'bg-ns-500 border-ns-300 text-white'
                        : count === 0
                          ? 'bg-mortar-950 border-mortar-800 text-mortar-700 cursor-not-allowed'
                          : 'bg-mortar-950 border-mortar-700 text-mortar-400 hover:border-mortar-600 hover:text-mortar-200',
                    ].join(' ')}
                  >
                    {meta.short}
                    <span className={[
                      'text-[9px] px-1 rounded leading-none font-mono',
                      on ? 'bg-white/20' : 'bg-mortar-800',
                    ].join(' ')}>
                      {count}
                    </span>
                  </button>
                )
              })}
              <span className="ml-auto text-[10px] text-mortar-500 italic hidden sm:inline">
                Hover a row to preview on map
              </span>
            </div>
          </div>

          {fitSuggestions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-mortar-500 text-sm mb-2">No fits in the selected windows.</div>
              <div className="text-[11px] text-mortar-600">
                {selectedBuckets.size < 3
                  ? 'Try toggling on more day windows above.'
                  : "Every rep's route is full or too far for this lead."}
              </div>
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
// Renders a single suggestion row. The information hierarchy is built
// around the three questions Cortney needs answered AT A GLANCE:
//   1. WHEN: day badge + slot time ("Tue · 10:30am")
//   2. WHERE: in this rep's route — "Between stop 3 and 4" or "After last"
//   3. DETOUR: how much extra drive does inserting this lead cost?
//
// On hover, the row signals the map to draw the rep's full day route with
// the new lead inserted at the right position. That hover preview is the
// *real* answer — this row is a label.
function SlotRow({ s, rep, rank, isHovered, showRepName, onMouseEnter, onMouseLeave, onClick }) {
  const detourColor = s.added_miles < 2 ? '#10b981' : s.added_miles < 10 ? '#f59e0b' : '#ef4444'
  const repColor = rep?.color || '#4a9dcf'
  // Friendlier "where in the day" copy. The backend gives us insert_label
  // ("After stop 3 (Smith)") which is fine but verbose — we tighten for the row.
  const whereText = (() => {
    if (!s.day_stops || s.day_stops.length === 0) return 'Open day — no other stops'
    const N = s.day_stops.length
    if (s.insert_index === 0) return `First stop of the day`
    if (s.insert_index >= N) return `After last stop`
    const before = s.day_stops[s.insert_index - 1]
    const after = s.day_stops[s.insert_index]
    const beforeName = (before?.job_name || 'stop').split(' — ')[0].slice(0, 18)
    const afterName = (after?.job_name || 'stop').split(' — ')[0].slice(0, 18)
    return `Between ${beforeName} & ${afterName}`
  })()
  return (
    <li
      className={[
        'group relative px-3 py-3 transition-all cursor-pointer',
        isHovered ? 'bg-mortar-800' : 'hover:bg-mortar-800/60',
      ].join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {/* Left edge accent bar — fills in rep color on hover */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 transition-opacity"
        style={{
          background: repColor,
          opacity: isHovered ? 1 : 0,
        }}
      />
      <div className="flex items-stretch gap-3">
        <DayBadge dayLabel={s.day_label} day={s.day} repColor={repColor} />
        {showRepName && (rep?.avatar_url ? (
          <img
            src={rep.avatar_url}
            alt=""
            className="w-8 h-8 rounded-full object-cover flex-shrink-0 self-center"
            style={{ boxShadow: `0 0 0 2px ${repColor}` }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full grid place-items-center flex-shrink-0 self-center text-white font-bold text-[10px]"
            style={{ background: repColor }}
          >
            {(rep?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        ))}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {showRepName && (
            <div className="flex items-center gap-2 mb-0.5">
              {rank != null && (
                <span
                  className="text-[10px] font-bold w-5 h-5 rounded-full grid place-items-center flex-shrink-0"
                  style={{ background: `${repColor}33`, color: repColor }}
                >
                  {rank}
                </span>
              )}
              <span className="text-[13px] font-semibold text-cream truncate">
                {rep?.name || s.rep_id}
              </span>
            </div>
          )}
          {/* Time slot — the most important info on this row after the day */}
          {s.slot_start && (
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className="text-[15px] font-bold text-cream font-display tracking-tight">
                {s.slot_start}
              </span>
              <span className="text-[10px] text-mortar-500">→ {s.slot_end}</span>
            </div>
          )}
          {/* Where in the day */}
          <div className="text-[11px] text-mortar-400 truncate flex items-center gap-1">
            <svg className="w-3 h-3 flex-shrink-0 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
            {whereText}
          </div>
        </div>
        {/* Detour — right-aligned, color-coded */}
        <div className="text-right flex-shrink-0 flex flex-col justify-center min-w-[60px]">
          <div className="text-[9px] uppercase tracking-wider text-mortar-500 leading-none mb-1">Detour</div>
          <div className="text-base font-bold leading-none font-display" style={{ color: detourColor }}>
            +{s.added_miles}<span className="text-[10px] font-normal opacity-75">mi</span>
          </div>
          <div className="text-[10px] text-mortar-500 mt-1 leading-none">+{s.added_drive_min}m drive</div>
        </div>
      </div>
    </li>
  )
}

// ── DayBadge ─────────────────────────────────────────────────
// Big visual day chip at the leading edge of each suggestion row. Two-line:
// abbreviated weekday on top, day-of-month underneath. Today is filled in
// the rep's color (pulses subtly to telegraph "act now"). Tomorrow gets an
// outline in the rep color. Later days are subdued cream-on-charcoal.
function DayBadge({ dayLabel, day, repColor }) {
  const d = day ? new Date(day + 'T12:00:00') : null
  const isToday = dayLabel === 'Today'
  const isTomorrow = dayLabel === 'Tomorrow'

  const top = isToday ? 'TODAY' : isTomorrow ? 'TMRW' : (d ? d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : '—')
  const bottom = d ? d.getDate() : '—'

  const fillColor = isToday ? repColor : 'transparent'
  const textColor = isToday ? '#ffffff' : isTomorrow ? repColor : '#e8e6e1'
  const borderColor = isToday ? repColor : isTomorrow ? repColor : '#3a4452'

  return (
    <div
      className="flex flex-col items-center justify-center flex-shrink-0 rounded-lg font-display self-center"
      style={{
        width: 48,
        height: 48,
        background: fillColor,
        border: `1.5px solid ${borderColor}`,
        boxShadow: isToday
          ? `0 0 0 3px ${repColor}26, 0 2px 8px rgba(0,0,0,0.5)`
          : isTomorrow
            ? `0 1px 3px rgba(0,0,0,0.3)`
            : 'none',
      }}
    >
      <span
        className="text-[8px] font-bold tracking-[0.12em] leading-none"
        style={{ color: isToday ? 'rgba(255,255,255,0.85)' : textColor }}
      >
        {top}
      </span>
      <span
        className="text-[18px] font-extrabold leading-none mt-1 tracking-tight"
        style={{ color: textColor }}
      >
        {bottom}
      </span>
    </div>
  )
}
