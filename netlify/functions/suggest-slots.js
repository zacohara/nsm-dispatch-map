// POST /api/suggest-slots
// Body: { address, duration_hrs, rep_ids?, lock_per_rep? }
// Geocodes address via OSM Nominatim, pulls dispatch_tasks for the next 5 days,
// and ranks insertion slots per (rep, day) by added drive distance.
//
// v0.19 — Real drive time via Mapbox Directions Matrix API (with haversine
// fallback). Adds `lock_per_rep` mode: when explicit rep_ids are passed,
// returns the best slot PER REP PER DAY (up to N reps × 5 days) instead of
// global top-5. This lets Cortney lock to e.g. Frankie + Roman and see all
// of their best openings side-by-side.
//
// Scoring (lower detour = better fit):
//   added_miles = haversine(prev → new) + haversine(new → next) − haversine(prev → next)
//                 (for end-of-day insert, just added_miles = haversine(last → new) × 2 for the round-trip back)
//   added_drive_min = real drive minutes via Mapbox Directions Matrix when
//                     available; otherwise miles / 35 mph × 60.
//   score = max(0, round(100 − added_miles × 2.5))

import { createClient } from '@supabase/supabase-js'

const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing Supabase env' }, 500)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const address = (body?.address || '').trim()
  const duration_hrs = Number(body?.duration_hrs) || 2
  const providedLat = body?.lat != null ? Number(body.lat) : null
  const providedLng = body?.lng != null ? Number(body.lng) : null
  // Optional: restrict scoring to a specific subset of reps (empty/null = all active reps).
  // Comes from the FitPanel rep selector chip row. Values are dispatch_crews.id strings.
  const repFilter = Array.isArray(body?.rep_ids) && body.rep_ids.length > 0
    ? new Set(body.rep_ids.map(String))
    : null
  // lock_per_rep: when true (and repFilter is set), return one best slot per
  // rep per day instead of global top 5. Intended for "lock to N reps" mode
  // where Cortney wants to compare each rep's best opening across the window.
  const lockPerRep = Boolean(body?.lock_per_rep) && repFilter !== null
  if (!address || address.length < 5) return json({ error: 'Address too short' }, 400)

  // If the client already geocoded (via Mapbox), use those coords directly
  let lat = providedLat, lng = providedLng, resolved = address

  // Otherwise fall back to Nominatim
  if (lat == null || lng == null) {
    try {
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
        { headers: { 'User-Agent': 'NorthShoreDispatch/1.0 (zac@northshoremasonry.com)' } }
      )
      if (geoResp.ok) {
        const arr = await geoResp.json()
        if (arr?.[0]) {
          lat = Number(arr[0].lat)
          lng = Number(arr[0].lon)
          resolved = arr[0].display_name || address
        }
      }
    } catch (_) { /* fall through */ }
  }

  if (lat == null || lng == null) {
    return json({ error: 'Could not geocode address', address, lat: null, lng: null, suggestions: [] }, 200)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Window: [today, today + FIT_WINDOW_DAYS − 1] inclusive.
  // Match src/lib/utils.js FIT_WINDOW_DAYS.
  const FIT_WINDOW_DAYS = 5
  const today = new Date()
  const startISO = today.toISOString().slice(0, 10)
  const end = new Date(today); end.setDate(end.getDate() + (FIT_WINDOW_DAYS - 1))
  const endISO = end.toISOString().slice(0, 10)

  const [{ data: repsRaw }, { data: tasks }] = await Promise.all([
    sb.from('dispatch_crews').select('id, name, color, priority_tier').eq('active', true),
    sb.from('dispatch_tasks')
      .select('id, crew_id, scheduled_date, start_time, lat, lng, job_name, job_address, is_blocker, duration_hrs')
      .gte('scheduled_date', startISO)
      .lte('scheduled_date', endISO),
  ])

  const reps = repFilter
    ? (repsRaw || []).filter(r => repFilter.has(String(r.id)))
    : (repsRaw || [])

  if (!reps?.length) return json({ address: resolved, lat, lng, suggestions: [] }, 200)

  // Tier bias (virtual mileage adjustment used only for ranking — does not
  // affect the added_miles value shown to the user). Lower tier number = higher
  // preference. Tier 1 reps get an 8-mile "head start"; tier 3 reps get an
  // 8-mile "handicap." A tier-3 rep still wins if their real detour is
  // significantly shorter than a tier-1 alternative.
  const TIER_BIAS_MI = { 1: -8, 2: 0, 3: 8 }
  const tierBias = (rep) => TIER_BIAS_MI[rep?.priority_tier] ?? 0

  // Split tasks into stops (real dispatch work that drives the route) vs
  // blockers (availability holds — WFH, PTO, doctor). Blockers don't get
  // sorted into the route but they DO make the rep's slot unavailable during
  // their time window, so we track them separately and use them to reject
  // insertion candidates that would collide.
  const stopsByCrewDay = new Map()     // key = `${crew_id}|${date}` → real-stop tasks (with lat/lng)
  const blockersByCrewDay = new Map()  // key = `${crew_id}|${date}` → availability blockers

  for (const t of tasks || []) {
    if (!t.crew_id) continue
    const k = `${t.crew_id}|${t.scheduled_date}`
    if (t.is_blocker) {
      if (!blockersByCrewDay.has(k)) blockersByCrewDay.set(k, [])
      blockersByCrewDay.get(k).push(t)
    } else if (t.lat != null && t.lng != null) {
      if (!stopsByCrewDay.has(k)) stopsByCrewDay.set(k, [])
      stopsByCrewDay.get(k).push(t)
    }
  }
  for (const arr of stopsByCrewDay.values()) {
    arr.sort((a, b) => (a.start_time || 'zz').localeCompare(b.start_time || 'zz'))
  }

  // Convert "HH:MM" + duration_hrs into a [startMin, endMin) range for collision checks.
  // Returns null if start_time missing (full-day block — treat as blocking the whole day).
  function blockerRangeMinutes(b) {
    if (!b.start_time) return { startMin: 0, endMin: 24 * 60 } // full-day
    const [h, m] = b.start_time.split(':').map(Number)
    if (isNaN(h)) return { startMin: 0, endMin: 24 * 60 }
    const startMin = h * 60 + (m || 0)
    const durMin = Math.max(30, Math.round((b.duration_hrs || 1) * 60))
    return { startMin, endMin: startMin + durMin }
  }

  // ── Build the drive-time lookup ─────────────────────────────
  // Collect every coord we'll route between: the new lead, every rep's home,
  // and every existing stop. Mapbox Matrix caps at 25 points per call; if we
  // exceed that we'll silently fall back to haversine (still works fine,
  // just less accurate). 16 reps × 1 home + ~10 distinct stops + 1 lead is
  // typically under the cap; if not, we slice to the relevant subset (only
  // reps in repFilter, only their stops).
  const matrixPoints = [{ lat, lng }]
  for (const rep of reps) {
    if (rep.home_lat != null && rep.home_lng != null) {
      matrixPoints.push({ lat: rep.home_lat, lng: rep.home_lng })
    }
  }
  for (const arr of stopsByCrewDay.values()) {
    for (const s of arr) {
      if (s.lat != null && s.lng != null) matrixPoints.push({ lat: s.lat, lng: s.lng })
    }
  }
  const drive = await buildDriveLookup(matrixPoints)
  let usedMapbox = false  // flips to true on the first mapbox-sourced result

  // Generate candidates: for each rep, for each day in window, consider insertion
  // at every gap (before stop 1, between stops, after last).
  const candidates = []
  const days = []
  for (let i = 0; i < FIT_WINDOW_DAYS; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }

  for (const rep of reps) {
    for (const day of days) {
      const stops = stopsByCrewDay.get(`${rep.id}|${day}`) || []
      const blockers = blockersByCrewDay.get(`${rep.id}|${day}`) || []
      const dow = new Date(day + 'T12:00:00').getDay() // 0=Sun, 6=Sat
      const isWeekend = dow === 0 || dow === 6

      // Is the rep's entire day blocked? (WFH all day, PTO, sick day)
      // If any blocker spans 6+ hours or starts at midnight, treat as full-day out.
      const blockerRanges = blockers.map(blockerRangeMinutes)
      const hasFullDayBlock = blockerRanges.some(r => (r.endMin - r.startMin) >= 6 * 60 || r.startMin === 0)
      if (hasFullDayBlock) continue // rep unavailable all day — no candidates for this day

      if (stops.length === 0) {
        // Empty day — but if a partial blocker exists, it still counts as "some" work
        const penalty_miles = isWeekend ? 25 : 8
        const penalty_min = Math.round((penalty_miles / 35) * 60)
        candidates.push({
          rep_id: rep.id,
          priority_tier: rep.priority_tier ?? 2,
          day,
          insert_index: 0,
          insert_label: blockers.length > 0
            ? 'Mostly open — rep has a partial block'
            : (isWeekend ? 'Open weekend day' : 'Open day — nothing scheduled'),
          added_miles: penalty_miles,
          rank_miles: penalty_miles + tierBias(rep),
          added_drive_min: penalty_min,
          _blockerRanges: blockerRanges,
        })
        continue
      }

      // Insertion at position k means "new stop goes between stops[k-1] and stops[k]"
      // k = 0          → before first stop (only measure stops[0] as anchor)
      // 0 < k < N      → between two stops (triangle detour)
      // k = N          → after last stop (round-trip back to last stop)
      const N = stops.length
      for (let k = 0; k <= N; k++) {
        let added_miles
        let added_drive_min
        let insert_label

        if (k === 0) {
          const first = stops[0]
          // Round-trip detour: leg out to new lead and back to first stop.
          const out = drive(first.lat, first.lng, lat, lng)
          const back = drive(lat, lng, first.lat, first.lng)
          added_miles = out.miles + back.miles
          added_drive_min = out.minutes + back.minutes
          if (out.source === 'mapbox' || back.source === 'mapbox') usedMapbox = true
          insert_label = `Before stop 1 (${first.job_name || 'job'})`
        } else if (k === N) {
          const last = stops[N - 1]
          const out = drive(last.lat, last.lng, lat, lng)
          const back = drive(lat, lng, last.lat, last.lng)
          added_miles = out.miles + back.miles
          added_drive_min = out.minutes + back.minutes
          if (out.source === 'mapbox' || back.source === 'mapbox') usedMapbox = true
          insert_label = `After stop ${N} (${last.job_name || 'job'})`
        } else {
          const prev = stops[k - 1]
          const next = stops[k]
          const direct = drive(prev.lat, prev.lng, next.lat, next.lng)
          const leg1 = drive(prev.lat, prev.lng, lat, lng)
          const leg2 = drive(lat, lng, next.lat, next.lng)
          added_miles = Math.max(0, leg1.miles + leg2.miles - direct.miles)
          added_drive_min = Math.max(0, leg1.minutes + leg2.minutes - direct.minutes)
          if (direct.source === 'mapbox' || leg1.source === 'mapbox' || leg2.source === 'mapbox') usedMapbox = true
          insert_label = `Between stop ${k} and ${k + 1}`
        }

        // Weekend slight penalty even with a real anchor
        if (isWeekend) {
          added_miles += 10
          added_drive_min += 17  // 10mi @ 35mph
        }

        // Collision check: if there are partial blockers on this day, reject
        // this candidate if our insertion would land inside the blocker window.
        // Estimates slot start time from the surrounding stop's start_time.
        const collidesWithBlocker = (() => {
          if (!blockerRanges.length) return false
          let slotStartMin
          if (k === 0) {
            const first = stops[0]
            if (first.start_time) {
              const [h, m] = first.start_time.split(':').map(Number)
              slotStartMin = Math.max(8 * 60, (h * 60 + (m || 0)) - 2 * 60)
            } else {
              slotStartMin = 8 * 60
            }
          } else if (k === N) {
            const last = stops[N - 1]
            if (last.start_time) {
              const [h, m] = last.start_time.split(':').map(Number)
              slotStartMin = (h * 60 + (m || 0)) + 2 * 60
            } else {
              slotStartMin = 14 * 60
            }
          } else {
            const prev = stops[k - 1]
            if (prev.start_time) {
              const [h, m] = prev.start_time.split(':').map(Number)
              slotStartMin = (h * 60 + (m || 0)) + 90
            } else {
              slotStartMin = 12 * 60
            }
          }
          const slotEndMin = slotStartMin + Math.max(60, Math.round((duration_hrs || 2) * 60))
          return blockerRanges.some(r => slotStartMin < r.endMin && slotEndMin > r.startMin)
        })()
        if (collidesWithBlocker) continue

        candidates.push({
          rep_id: rep.id,
          priority_tier: rep.priority_tier ?? 2,
          day,
          insert_index: k,
          insert_label,
          added_miles: Math.round(added_miles * 10) / 10,
          rank_miles: added_miles + tierBias(rep),
          added_drive_min: Math.round(added_drive_min),
        })
      }
    }
  }

  // Rank: lower rank_miles wins (real detour + tier bias). Keep best candidate
  // per (rep, day) so we don't flood the result with 5 positions from the same
  // rep. Display-facing added_miles stays pure.
  const bestPerRepDay = new Map()
  for (const c of candidates) {
    const k = `${c.rep_id}|${c.day}`
    const cur = bestPerRepDay.get(k)
    if (!cur || c.rank_miles < cur.rank_miles) bestPerRepDay.set(k, c)
  }

  // Two ranking modes:
  //  - default: top 5 globally (best (rep, day) combos overall)
  //  - lock_per_rep: best slot per rep per day for each rep in repFilter,
  //    sorted rep-major then day-major. Caps at 25 results to keep payloads sane.
  let rankedRaw
  if (lockPerRep) {
    // Group by rep, take each rep's best 5 days (sorted by rank_miles)
    const byRep = new Map()
    for (const c of bestPerRepDay.values()) {
      if (!byRep.has(c.rep_id)) byRep.set(c.rep_id, [])
      byRep.get(c.rep_id).push(c)
    }
    // Preserve repFilter ordering when possible — lets the UI show reps in
    // the order Cortney clicked them.
    const orderedRepIds = repFilter
      ? Array.from(repFilter).filter(id => byRep.has(id))
      : Array.from(byRep.keys())
    rankedRaw = []
    for (const rid of orderedRepIds) {
      const repCandidates = (byRep.get(rid) || [])
        .sort((a, b) => a.rank_miles - b.rank_miles)
        .slice(0, 5)
      rankedRaw.push(...repCandidates)
    }
    rankedRaw = rankedRaw.slice(0, 25)
  } else {
    rankedRaw = Array.from(bestPerRepDay.values())
      .sort((a, b) => a.rank_miles - b.rank_miles)
      .slice(0, 5)
  }

  const ranked = rankedRaw.map(c => {
    // Embed the rep's existing stops for that day so the client can
    // render a preview route (Home → stops → NEW slot → Home) on hover.
    const dayStops = (stopsByCrewDay.get(`${c.rep_id}|${c.day}`) || []).map(s => ({
      id: s.id,
      job_name: s.job_name,
      job_address: s.job_address,
      lat: s.lat,
      lng: s.lng,
      start_time: s.start_time,
    }))
    return {
      ...c,
      day_label: formatDayLabel(c.day),
      score: Math.max(0, Math.round(100 - c.added_miles * 2.5)),
      day_stops: dayStops,
    }
  })

  return json({
    address: resolved,
    lat, lng,
    duration_hrs,
    suggestions: ranked,
    drive_source: usedMapbox ? 'mapbox' : 'haversine',
    lock_per_rep: lockPerRep,
  }, 200)
}

function haversineMi(lat1, lng1, lat2, lng2) {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Round to 4 decimals (~11m precision) for cache keys — close enough that
// real-world coordinate jitter from geocoders doesn't fragment the cache.
function coordKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

// Fetch a drive-time + drive-distance matrix from Mapbox for up to 25 points.
// Returns { durationsMin: number[][], distancesMi: number[][] } where index
// matches the input `points` array. Both matrices are square, indexed [from][to].
// Returns null on failure — caller falls back to haversine.
//
// Mapbox Directions Matrix v1: returns durations in seconds and distances in
// meters when annotations=duration,distance. Free tier is 100k requests/month.
// One search ≈ 1-2 matrix calls (≤25 points each), so well within budget.
async function fetchMapboxMatrix(points) {
  if (!MAPBOX_TOKEN) return null
  if (points.length < 2 || points.length > 25) return null
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';')
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
              `?annotations=duration,distance&access_token=${MAPBOX_TOKEN}`
  try {
    const r = await fetch(url, {
      // Mapbox Matrix is slow with many points — cap at 6s so we degrade
      // gracefully to haversine instead of timing out the whole function.
      signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) return null
    const data = await r.json()
    if (data.code !== 'Ok' || !Array.isArray(data.durations)) return null
    // durations[i][j] = seconds from i to j; distances[i][j] = meters
    const durationsMin = data.durations.map(row =>
      row.map(s => s == null ? null : s / 60)
    )
    const distancesMi = (data.distances || []).map(row =>
      row.map(m => m == null ? null : m / 1609.344)
    )
    return { durationsMin, distancesMi }
  } catch (_) {
    return null
  }
}

// Build a unified drive-time function over a set of points. Tries Mapbox once
// (single matrix call), caches results, falls back to haversine if Mapbox
// is unavailable or returns nulls for a given pair.
async function buildDriveLookup(points) {
  // Dedupe by rounded coord to keep us under the 25-point Matrix cap.
  const keyed = []
  const keyToIdx = new Map()
  for (const p of points) {
    if (p.lat == null || p.lng == null) continue
    const k = coordKey(p.lat, p.lng)
    if (keyToIdx.has(k)) continue
    keyToIdx.set(k, keyed.length)
    keyed.push({ lat: p.lat, lng: p.lng, key: k })
  }

  // If we'd blow past the 25-point cap, skip Mapbox entirely — would need
  // chunked matrix fetches (future work). Haversine is the floor.
  let matrix = null
  if (keyed.length >= 2 && keyed.length <= 25) {
    matrix = await fetchMapboxMatrix(keyed)
  }

  // Returns { miles, minutes } between two coords. Uses Mapbox when present,
  // falls back to haversine for any pair Mapbox couldn't route.
  return function drivePair(lat1, lng1, lat2, lng2) {
    const fallbackMi = haversineMi(lat1, lng1, lat2, lng2)
    const fallbackMin = (fallbackMi / 35) * 60
    if (!matrix) return { miles: fallbackMi, minutes: fallbackMin, source: 'haversine' }
    const i = keyToIdx.get(coordKey(lat1, lng1))
    const j = keyToIdx.get(coordKey(lat2, lng2))
    if (i == null || j == null) {
      return { miles: fallbackMi, minutes: fallbackMin, source: 'haversine' }
    }
    const min = matrix.durationsMin?.[i]?.[j]
    const mi = matrix.distancesMi?.[i]?.[j]
    if (min == null || mi == null) {
      return { miles: fallbackMi, minutes: fallbackMin, source: 'haversine' }
    }
    return { miles: mi, minutes: min, source: 'mapbox' }
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function formatDayLabel(iso) {
  const d = new Date(iso + 'T12:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
