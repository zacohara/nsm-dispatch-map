// Date helpers

// Canonical size of the dispatch planning window (in days, including today).
// Every surface that renders days, counts tasks in the horizon, or pulls JT
// data should derive its bounds from this single value so they never drift.
//   - DayStrip renders exactly DISPATCH_WINDOW_DAYS buttons
//   - strip-counts preload pulls [today, today + DISPATCH_WINDOW_DAYS − 1]
//   - sync-jobtread.js pulls tasks in [today, today + DISPATCH_WINDOW_DAYS − 1]
//   - suggest-slots.js ranks slots in [today, today + FIT_WINDOW_DAYS − 1]
// FIT_WINDOW_DAYS is intentionally shorter — we don't recommend a lead be
// booked 14 days out when the rep's day 14 calendar isn't settled yet.
export const DISPATCH_WINDOW_DAYS = 14
export const FIT_WINDOW_DAYS = 5

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtDate(iso, style = 'short') {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  if (style === 'short') {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function isToday(iso) {
  return iso === todayISO()
}

// Distance in miles (haversine)
export function distanceMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0
  const R = 3959
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Rough drive time estimate (miles / 35 mph avg with urban surcharge)
export function driveMinutes(miles) {
  if (!miles) return 0
  const base = (miles / 35) * 60
  const urbanSurcharge = miles < 5 ? 6 : miles < 15 ? 10 : 4
  return Math.round(base + urbanSurcharge)
}

export function classifyMarket(lat, lng) {
  if (lat == null || lng == null) return 'Unknown'
  if (lat > 41.4 && lat < 42.5 && lng > -88.5 && lng < -87.3) return 'Chicago'
  if (lat > 42.5 && lat < 43.8 && lng > -88.5 && lng < -87.5) return 'Milwaukee'
  if (lat > 32.0 && lat < 33.5 && lng > -98 && lng < -96) return 'Dallas'
  if (lat > 39.5 && lat < 40.2 && lng > -86.5 && lng < -85.5) return 'Indianapolis'
  return 'Unknown'
}

// Lens metadata for the market tabs. Each lens defines which tasks/reps are
// in scope, and what bounds to use for the "focus map here" behavior.
//
// `all` is intentionally NOT world-wide — it's Chicago + Milwaukee combined,
// since that's where ~95% of NSM's work is. Dallas / Indianapolis pins still
// render (they're in the data), but they don't drag the auto-fit open.
//
// When a user taps the Dallas pin on the "all" tab, MapView can still recenter
// on it; the bounds only govern the default view.
export const MARKETS = {
  chicago: {
    key: 'chicago',
    label: 'Chicago',
    // SW + NE corners. Slight padding so peripheral stops (Naperville, Joliet,
    // Crystal Lake) stay in frame without cropping.
    bounds: [[41.30, -88.60], [42.55, -87.25]],
    center: [41.8781, -87.6298],
    classify: 'Chicago',
  },
  milwaukee: {
    key: 'milwaukee',
    label: 'Milwaukee',
    bounds: [[42.55, -88.50], [43.85, -87.50]],
    center: [43.0389, -87.9065],
    classify: 'Milwaukee',
  },
  all: {
    key: 'all',
    label: 'All',
    // Chicago + Milwaukee combined. This is the deliberate default framing —
    // south edge below Chicago, north edge above Milwaukee, east to Lake MI,
    // west to Rockford. Dallas / Indy pins render but sit outside these bounds.
    bounds: [[41.30, -88.60], [43.85, -87.25]],
    center: [42.5, -87.95],
    classify: null, // no classify filter — show everything
  },
}

// Returns true if a given lat/lng should appear under the current market lens.
// For `all`, we still show outlier markets (Dallas, Indy) — they're real work
// and users can pan to find them. For `chicago` / `milwaukee`, strict filter.
export function taskInMarket(marketKey, lat, lng) {
  if (marketKey === 'all') return true
  if (lat == null || lng == null) return false
  return classifyMarket(lat, lng) === MARKETS[marketKey]?.classify
}

// A rep shows under a market lens if EITHER their home is in that market OR
// at least one of the visible-window tasks is. That way Luke (Prospect Heights
// home) still appears on Milwaukee when he's got a Milwaukee route that day.
export function repInMarket(marketKey, rep, tasks) {
  if (marketKey === 'all') return true
  const homeIn = taskInMarket(marketKey, rep?.home_lat, rep?.home_lng)
  if (homeIn) return true
  return (tasks || []).some(t => t.crew_id === rep?.id && taskInMarket(marketKey, t.lat, t.lng))
}

export function crewColor(crewId, crews) {
  if (!crewId) return '#6d675d'
  const c = crews.find(x => x.id === crewId)
  return c?.color || '#b04a3c'
}

export function formatTime(t) {
  if (!t) return ''
  // Accepts "08:00" or ISO — keep 12hr display
  const hm = t.length >= 5 ? t.slice(0, 5) : t
  const [hh, mm] = hm.split(':').map(Number)
  if (isNaN(hh)) return t
  const ampm = hh >= 12 ? 'p' : 'a'
  const h12 = ((hh + 11) % 12) + 1
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`
}
