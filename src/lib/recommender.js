import { distanceMiles, driveMinutes } from './utils'

// Total crew-day miles: home → sorted stops → home (round-trip loop)
// Only adds a home leg if home_lat/lng is populated.
//
// Filters out is_blocker tasks — availability blocks (WFH, PTO, etc.) aren't
// places the rep drives to, they're time windows. Counting them as stops would
// falsely inflate drive distance and make "efficient" days look bad.
export function crewDayMiles(crew, crewTasks) {
  const realTasks = (crewTasks || []).filter(t => !t.is_blocker)
  if (!realTasks.length) return 0
  const sorted = [...realTasks].sort(
    (a, b) => (a.start_time || 'zz').localeCompare(b.start_time || 'zz')
  )
  let total = 0
  const hasHome = crew?.home_lat != null && crew?.home_lng != null
  let prevLat = hasHome ? crew.home_lat : sorted[0]?.lat
  let prevLng = hasHome ? crew.home_lng : sorted[0]?.lng

  for (const t of sorted) {
    if (t.lat != null && prevLat != null) {
      total += distanceMiles(prevLat, prevLng, t.lat, t.lng) || 0
    }
    if (t.lat != null) {
      prevLat = t.lat
      prevLng = t.lng
    }
  }
  // Return leg back home
  if (hasHome && prevLat != null) {
    total += distanceMiles(prevLat, prevLng, crew.home_lat, crew.home_lng) || 0
  }
  return Math.round(total)
}

export function crewDayDriveMin(crew, crewTasks) {
  return driveMinutes(crewDayMiles(crew, crewTasks))
}

// Core swap recommender — suggests moving a task from crew A to crew B
// when total miles across both crews drops by ≥ 8 miles.
//
// Only considers reps that BOTH have home_lat populated (otherwise the
// mileage comparison is apples to oranges). Caps at 5 suggestions total.
export function recommendSwaps(crews, tasks) {
  const active = crews.filter(c => c.active !== false && c.home_lat != null)
  if (active.length < 2) return []

  const byCrew = new Map()
  active.forEach(c => byCrew.set(c.id, []))
  tasks.forEach(t => {
    if (t.crew_id && byCrew.has(t.crew_id)) byCrew.get(t.crew_id).push(t)
  })

  const baseline = new Map()
  active.forEach(c => baseline.set(c.id, crewDayMiles(c, byCrew.get(c.id) || [])))

  const suggestions = []
  tasks.forEach(task => {
    if (!task.crew_id || task.lat == null) return
    // Never suggest moving a rep's own availability blocker to another rep.
    if (task.is_blocker) return
    const fromCrew = active.find(c => c.id === task.crew_id)
    if (!fromCrew) return

    active.forEach(toCrew => {
      if (toCrew.id === task.crew_id) return

      const fromTasks = byCrew.get(fromCrew.id) || []
      const toTasks = byCrew.get(toCrew.id) || []
      const newFrom = fromTasks.filter(t => t.id !== task.id)
      const newTo = [...toTasks, task]

      const oldTotal = (baseline.get(fromCrew.id) || 0) + (baseline.get(toCrew.id) || 0)
      const newTotal = crewDayMiles(fromCrew, newFrom) + crewDayMiles(toCrew, newTo)
      const delta = newTotal - oldTotal

      if (delta <= -8) {
        suggestions.push({
          task_id: task.id,
          task_name: task.job_name,
          task_address: task.job_address,
          from_crew_id: fromCrew.id,
          from_crew_name: fromCrew.name,
          to_crew_id: toCrew.id,
          to_crew_name: toCrew.name,
          miles_saved: Math.abs(Math.round(delta)),
          minutes_saved: driveMinutes(Math.abs(delta)),
        })
      }
    })
  })

  // Dedupe — one suggestion per task, keep biggest savings
  const bestByTask = new Map()
  suggestions.forEach(s => {
    const cur = bestByTask.get(s.task_id)
    if (!cur || s.miles_saved > cur.miles_saved) bestByTask.set(s.task_id, s)
  })

  return Array.from(bestByTask.values())
    .sort((a, b) => b.miles_saved - a.miles_saved)
    .slice(0, 5)
}

// Health score: orphans + high per-rep mileage.
// Blockers (WFH/PTO/etc.) are excluded — they aren't real work, they're time
// holds. Counting a blocker-without-crew as "orphan" would deflate the score
// unfairly, and including blockers in mileage is handled inside crewDayMiles.
export function dayHealth(crews, tasks) {
  const realTasks = (tasks || []).filter(t => !t.is_blocker)
  if (!realTasks.length) return { score: 100, orphans: 0, avgMiles: 0, totalSaving: 0 }
  const orphans = realTasks.filter(t => !t.crew_id).length
  const active = crews.filter(c => c.active !== false)

  const byCrew = new Map()
  active.forEach(c => byCrew.set(c.id, []))
  realTasks.forEach(t => { if (t.crew_id && byCrew.has(t.crew_id)) byCrew.get(t.crew_id).push(t) })

  const totals = Array.from(byCrew.entries()).map(([id, ts]) => {
    const c = active.find(x => x.id === id)
    return crewDayMiles(c, ts)
  }).filter(x => x > 0)

  const avgMiles = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0

  const orphanPenalty = orphans * 8
  const mileagePenalty = Math.max(0, (avgMiles - 80) * 0.3)
  const score = Math.max(0, Math.round(100 - orphanPenalty - mileagePenalty))

  return { score, orphans, avgMiles }
}
