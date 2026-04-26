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
  // Rep filter. null = include all active reps (the default on every reload).
  // A Set of rep ids means "only these". Not persisted — resets on reload.
  const [includedRepIds, setIncludedRepIds] = useState(null)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  const activeCrews = crews.filter(c => c.active !== false)
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

      {/* Rep selector chip row — hidden when a result is locked to keep the
          post-search drawer tidy; resets to "all" on every reload. */}
      {!isLocked && activeCrews.length > 0 && (
        <div className="px-3 pt-2 pb-1 flex items-center gap-2 overflow-x-auto flex-nowrap whitespace-nowrap">
          <button
            type="button"
            onClick={toggleAll}
            className={[
              'flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 border transition',
              allSelected
                ? 'bg-ns-500 border-ns-400 text-white'
                : 'bg-mortar-900 border-mortar-700 text-mortar-400 hover:border-ns-500',
            ].join(' ')}
            title={allSelected ? 'Searching across every active rep' : 'Lock search to selected reps — see each rep\'s best openings across the 5-day window'}
          >
            <span
              className={[
                'w-6 h-3 rounded-full relative transition',
                allSelected ? 'bg-white/30' : 'bg-mortar-700',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 w-2 h-2 rounded-full bg-white transition-all',
                  allSelected ? 'left-3.5' : 'left-0.5',
                ].join(' ')}
              />
            </span>
            {allSelected ? 'All reps' : `Locked${includedRepIds && includedRepIds.size > 0 ? ` (${includedRepIds.size})` : ''}`}
          </button>
          <div className="w-px h-5 bg-mortar-800 flex-shrink-0" />
          {activeCrews.map(c => {
            const on = isRepIncluded(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleRep(c.id)}
                className={[
                  'flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium flex-shrink-0 border transition',
                  on
                    ? 'text-white'
                    : 'bg-mortar-900 border-mortar-700 text-mortar-500 hover:border-mortar-500',
                ].join(' ')}
                style={on ? { background: c.color, borderColor: c.color } : undefined}
                title={on ? `Click to exclude ${c.name}` : `Click to include ${c.name}`}
              >
                {c.avatar_url ? (
                  <img
                    src={c.avatar_url}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: on ? 'rgba(255,255,255,0.8)' : c.color }}
                  />
                )}
                <span>{c.name.split(' ')[0]}</span>
              </button>
            )
          })}
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
