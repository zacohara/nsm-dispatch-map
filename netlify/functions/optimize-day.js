// POST /api/optimize-day — { date }
// Returns suggested swaps. Mirror of client-side recommender — useful for future batch ops.

import { createClient } from '@supabase/supabase-js'

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Missing env' }, 500)

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const date = body?.date
  if (!date) return json({ error: 'date required (YYYY-MM-DD)' }, 400)

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const [{ data: crews }, { data: tasks }] = await Promise.all([
    sb.from('dispatch_crews').select('*').eq('active', true),
    sb.from('dispatch_tasks').select('*').eq('scheduled_date', date),
  ])

  const suggestions = recommendSwaps(crews || [], tasks || [])
  return json({ date, suggestions, total_suggested: suggestions.length })
}

// ── Inlined from src/lib/recommender.js (kept in sync manually for v1) ──

function distanceMiles(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return 0
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function driveMinutes(miles) {
  if (!miles) return 0
  const base = (miles / 35) * 60
  const urbanSurcharge = miles < 5 ? 6 : miles < 15 ? 10 : 4
  return Math.round(base + urbanSurcharge)
}

function crewDayMiles(crew, crewTasks) {
  if (!crewTasks.length) return 0
  const sorted = [...crewTasks].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  let total = 0
  let prevLat = crew?.home_lat ?? sorted[0]?.lat
  let prevLng = crew?.home_lng ?? sorted[0]?.lng
  sorted.forEach(t => {
    if (t.lat != null && prevLat != null) total += distanceMiles(prevLat, prevLng, t.lat, t.lng) || 0
    prevLat = t.lat ?? prevLat; prevLng = t.lng ?? prevLng
  })
  return Math.round(total)
}

function recommendSwaps(crews, tasks) {
  const active = crews.filter(c => c.active !== false)
  const byCrew = new Map()
  active.forEach(c => byCrew.set(c.id, []))
  tasks.forEach(t => { if (t.crew_id && byCrew.has(t.crew_id)) byCrew.get(t.crew_id).push(t) })

  const baseline = new Map()
  active.forEach(c => baseline.set(c.id, crewDayMiles(c, byCrew.get(c.id) || [])))

  const suggestions = []
  tasks.forEach(task => {
    if (!task.crew_id || task.lat == null) return
    const fromCrew = active.find(c => c.id === task.crew_id)
    if (!fromCrew) return
    active.forEach(toCrew => {
      if (toCrew.id === task.crew_id) return
      if (fromCrew.market && toCrew.market && fromCrew.market !== toCrew.market) return
      const fromTasks = byCrew.get(fromCrew.id) || []
      const toTasks = byCrew.get(toCrew.id) || []
      const newFrom = fromTasks.filter(t => t.id !== task.id)
      const newTo = [...toTasks, task]
      const oldTotal = (baseline.get(fromCrew.id) || 0) + (baseline.get(toCrew.id) || 0)
      const newTotal = crewDayMiles(fromCrew, newFrom) + crewDayMiles(toCrew, newTo)
      const delta = newTotal - oldTotal
      if (delta <= -5) {
        suggestions.push({
          task_id: task.id, task_name: task.job_name,
          from_crew_id: fromCrew.id, from_crew_name: fromCrew.name,
          to_crew_id: toCrew.id, to_crew_name: toCrew.name,
          miles_saved: Math.abs(Math.round(delta)),
          minutes_saved: driveMinutes(Math.abs(delta)),
        })
      }
    })
  })
  const best = new Map()
  suggestions.forEach(s => {
    const cur = best.get(s.task_id)
    if (!cur || s.miles_saved > cur.miles_saved) best.set(s.task_id, s)
  })
  return Array.from(best.values()).sort((a, b) => b.miles_saved - a.miles_saved)
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/optimize-day' }
