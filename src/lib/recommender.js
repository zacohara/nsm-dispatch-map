import { distanceMiles, driveMinutes } from './utils'

// Compute total crew-day miles (home → task1 → task2 ... → homeward-ish)
export function crewDayMiles(crew, crewTasks) {
  if (!crewTasks.length) return 0
  const sorted = [...crewTasks].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  let total = 0
  let prevLat = crew?.home_lat ?? sorted[0]?.lat
  let prevLng = crew?.home_lng ?? sorted[0]?.lng
  sorted.forEach(t => {
    if (t.lat != null && prevLat != null) {
      total += distanceMiles(prevLat, prevLng, t.lat, t.lng) || 0
    }
    prevLat = t.lat ?? prevLat
    prevLng = t.lng ?? prevLng
  })
  return Math.round(total)
}

export function crewDayDriveMin(crew, crewTasks) {
  return driveMinutes(crewDayMiles(crew, crewTasks))
}

// Core swap recommender:
//   For each task, find the nearest other crew whose current day has tasks
//   in the same cluster, and compute the miles delta if we moved this task
//   to that crew. If delta < -5 miles total, suggest the swap.
export function recommendSwaps(crews, tasks) {
  const active = crews.filter(c => c.active !== false)
  const byCrew = new Map()
  active.forEach(c => byCrew.set(c.id, []))
  tasks.forEach(t => {
    if (t.crew_id && byCrew.has(t.crew_id)) byCrew.get(t.crew_id).push(t)
  })

  // Baseline miles per crew
  const baseline = new Map()
  active.forEach(c => baseline.set(c.id, crewDayMiles(c, byCrew.get(c.id) || [])))

  const suggestions = []
  tasks.forEach(task => {
    if (!task.crew_id || task.lat == null) return
    const fromCrew = active.find(c => c.id === task.crew_id)
    if (!fromCrew) return

    active.forEach(toCrew => {
      if (toCrew.id === task.crew_id) return
      // Skip cross-market swaps
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
          task_id: task.id,
          task_name: task.job_name,
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

  return Array.from(bestByTask.values()).sort((a, b) => b.miles_saved - a.miles_saved)
}

// Health score: 0-100 based on orphans + crossmarket tasks + high drive time
export function dayHealth(crews, tasks) {
  if (!tasks.length) return { score: 100, orphans: 0, crossMarket: 0, avgMiles: 0 }
  const orphans = tasks.filter(t => !t.crew_id).length
  const active = crews.filter(c => c.active !== false)
  let crossMarket = 0
  tasks.forEach(t => {
    const c = active.find(x => x.id === t.crew_id)
    if (c && c.market && t.lat != null) {
      // Simple distance-from-hub check
      const d = distanceMiles(c.home_lat, c.home_lng, t.lat, t.lng)
      if (d > 60) crossMarket += 1
    }
  })
  const byCrew = new Map()
  active.forEach(c => byCrew.set(c.id, []))
  tasks.forEach(t => { if (t.crew_id && byCrew.has(t.crew_id)) byCrew.get(t.crew_id).push(t) })
  const totals = Array.from(byCrew.entries()).map(([id, ts]) => {
    const c = active.find(x => x.id === id)
    return crewDayMiles(c, ts)
  }).filter(x => x > 0)
  const avgMiles = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0

  const orphanPenalty = orphans * 8
  const crossPenalty = crossMarket * 5
  const mileagePenalty = Math.max(0, (avgMiles - 60) * 0.4)
  const score = Math.max(0, Math.round(100 - orphanPenalty - crossPenalty - mileagePenalty))
  return { score, orphans, crossMarket, avgMiles }
}
