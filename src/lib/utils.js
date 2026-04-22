// Date helpers
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
