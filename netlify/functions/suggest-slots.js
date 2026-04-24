// POST /api/suggest-slots
// Body: { address, duration_hrs }
// Geocodes address via OSM Nominatim, pulls dispatch_tasks for the next 4 days,
// and ranks the top 5 insertion slots per (rep, day) by added drive distance.
//
// Scoring (lower detour = better fit):
//   added_miles = haversine(prev → new) + haversine(new → next) − haversine(prev → next)
//                 (for end-of-day insert, just added_miles = haversine(last → new) × 2 for the round-trip back)
//   added_drive_min = added_miles / 35 mph × 60  (rough urban avg)
//   score = max(0, round(100 − added_miles × 2.5))

import { createClient } from '@supabase/supabase-js'

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
          added_drive_min: Math.round((penalty_miles / 35) * 60),
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
        let insert_label

        if (k === 0) {
          const first = stops[0]
          added_miles = 2 * haversineMi(lat, lng, first.lat, first.lng)
          insert_label = `Before stop 1 (${first.job_name || 'job'})`
        } else if (k === N) {
          const last = stops[N - 1]
          added_miles = 2 * haversineMi(lat, lng, last.lat, last.lng)
          insert_label = `After stop ${N} (${last.job_name || 'job'})`
        } else {
          const prev = stops[k - 1]
          const next = stops[k]
          const direct = haversineMi(prev.lat, prev.lng, next.lat, next.lng)
          const viaNew = haversineMi(prev.lat, prev.lng, lat, lng) +
                         haversineMi(lat, lng, next.lat, next.lng)
          added_miles = Math.max(0, viaNew - direct)
          insert_label = `Between stop ${k} and ${k + 1}`
        }

        // Weekend slight penalty even with a real anchor
        if (isWeekend) added_miles += 10

        const added_drive_min = Math.round((added_miles / 35) * 60)

        // Collision check: if there are partial blockers on this day, reject
        // this candidate if our insertion would land inside the blocker window.
        // We approximate insertion start time by taking the previous stop's
        // start_time + drive + 1hr, or "before stop 1" → anchor at 8am.
        // This is approximate — sync provides start_time on stops but we don't
        // know yet what start_time the user would assign to the NEW slot. For
        // the MVP the collision check uses the midpoint of the gap between
        // the surrounding stops; we refine when we ship the "book" button.
        const collidesWithBlocker = (() => {
          if (!blockerRanges.length) return false
          // Estimated slot start — best guess given the gap
          let slotStartMin
          if (k === 0) {
            // Before first stop — anchor at 8am or first stop's time - 2hr
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
          added_drive_min,
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
  const ranked = Array.from(bestPerRepDay.values())
    .sort((a, b) => a.rank_miles - b.rank_miles)
    .slice(0, 5)
    .map(c => {
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

function formatDayLabel(iso) {
  const d = new Date(iso + 'T12:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
