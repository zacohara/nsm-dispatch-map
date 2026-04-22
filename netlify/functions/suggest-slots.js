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

  // Window: today → +4 days
  const today = new Date()
  const startISO = today.toISOString().slice(0, 10)
  const end = new Date(today); end.setDate(end.getDate() + 4)
  const endISO = end.toISOString().slice(0, 10)

  const [{ data: reps }, { data: tasks }] = await Promise.all([
    sb.from('dispatch_crews').select('id, name, color').eq('active', true),
    sb.from('dispatch_tasks')
      .select('id, crew_id, scheduled_date, start_time, lat, lng, job_name, job_address')
      .gte('scheduled_date', startISO)
      .lte('scheduled_date', endISO)
      .not('lat', 'is', null),
  ])

  if (!reps?.length) return json({ address: resolved, lat, lng, suggestions: [] }, 200)

  // Group tasks by rep/day, sorted by start_time
  const buckets = new Map() // key = `${crew_id}|${date}` → tasks[]
  for (const t of tasks || []) {
    if (!t.crew_id) continue
    const k = `${t.crew_id}|${t.scheduled_date}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(t)
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (a.start_time || 'zz').localeCompare(b.start_time || 'zz'))
  }

  // Generate candidates: for each rep, for each day in window, consider insertion
  // at every gap (before stop 1, between stops, after last).
  const candidates = []
  const days = []
  for (let i = 0; i <= 4; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }

  for (const rep of reps) {
    for (const day of days) {
      const stops = buckets.get(`${rep.id}|${day}`) || []
      const dow = new Date(day + 'T12:00:00').getDay() // 0=Sun, 6=Sat
      const isWeekend = dow === 0 || dow === 6

      if (stops.length === 0) {
        // Empty day: some capacity penalty so a real tight anchor-fit can outrank it.
        // Weekend empty days are last resort (NSM doesn't typically work weekends).
        const penalty_miles = isWeekend ? 25 : 8
        candidates.push({
          rep_id: rep.id,
          day,
          insert_index: 0,
          insert_label: isWeekend ? 'Open weekend day' : 'Open day — nothing scheduled',
          added_miles: penalty_miles,
          added_drive_min: Math.round((penalty_miles / 35) * 60),
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
        candidates.push({
          rep_id: rep.id,
          day,
          insert_index: k,
          insert_label,
          added_miles: Math.round(added_miles * 10) / 10,
          added_drive_min,
        })
      }
    }
  }

  // Rank: lower added_miles wins. Keep best candidate per (rep, day) so we don't
  // flood the result with 5 positions from the same rep.
  const bestPerRepDay = new Map()
  for (const c of candidates) {
    const k = `${c.rep_id}|${c.day}`
    const cur = bestPerRepDay.get(k)
    if (!cur || c.added_miles < cur.added_miles) bestPerRepDay.set(k, c)
  }
  const ranked = Array.from(bestPerRepDay.values())
    .sort((a, b) => a.added_miles - b.added_miles)
    .slice(0, 5)
    .map(c => ({
      ...c,
      day_label: formatDayLabel(c.day),
      score: Math.max(0, Math.round(100 - c.added_miles * 2.5)),
    }))

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
