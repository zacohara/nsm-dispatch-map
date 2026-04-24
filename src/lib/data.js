import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

export function useDispatchData(date) {
  const [crews, setCrews] = useState([])
  const [tasks, setTasks] = useState([])
  const [syncInfo, setSyncInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: crewRows, error: cErr }, { data: taskRows, error: tErr }, { data: syncRows }] =
        await Promise.all([
          supabase.from('dispatch_crews').select('*').eq('active', true).order('name'),
          supabase.from('dispatch_tasks').select('*').eq('scheduled_date', date).order('start_time'),
          supabase.from('dispatch_sync_log').select('*').order('started_at', { ascending: false }).limit(1),
        ])
      if (cErr) throw cErr
      if (tErr) throw tErr
      setCrews(crewRows || [])
      setTasks(taskRows || [])
      setSyncInfo(syncRows?.[0] || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  // Realtime subscription for tasks on the visible date.
  // We care about three state transitions:
  //   - old date ≠ visible, new date = visible  → task MOVED IN (or just got inserted on this day)
  //   - old date = visible, new date ≠ visible  → task MOVED OUT (treat as delete for this viewer)
  //   - both = visible                           → normal in-place update
  //   - neither = visible                        → ignore
  // The v0.18c-and-earlier code only checked payload.new, so a task moving
  // Friday → Monday while viewing Friday would silently stay on Friday until
  // a manual reload.
  useEffect(() => {
    const ch = supabase
      .channel(`dispatch-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_tasks' }, (payload) => {
        const oldDate = payload.old?.scheduled_date
        const newDate = payload.new?.scheduled_date
        const rowId = payload.new?.id || payload.old?.id
        if (!rowId) return

        // Neither before nor after touches this viewer's day → skip
        if (oldDate !== date && newDate !== date) return

        // Pure DELETE
        if (payload.eventType === 'DELETE') {
          setTasks(prev => prev.filter(t => t.id !== rowId))
          return
        }

        // Moved OUT: was on our day, now isn't → drop it
        if (oldDate === date && newDate !== date) {
          setTasks(prev => prev.filter(t => t.id !== rowId))
          return
        }

        // Moved IN or in-place update: upsert into the list
        const row = payload.new
        if (!row) return
        setTasks(prev => {
          const idx = prev.findIndex(t => t.id === row.id)
          if (idx === -1) {
            return [...prev, row].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
          }
          const copy = [...prev]
          copy[idx] = row
          return copy
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [date])

  return { crews, tasks, syncInfo, loading, error, reload: load }
}

// ── API callers ───────────────────────────────────────────

export async function triggerSync() {
  const r = await fetch('/api/sync-jobtread', { method: 'POST' })
  if (!r.ok) throw new Error(`Sync failed: ${r.status}`)
  return r.json()
}

export async function reassignTask(taskId, newCrewId, reason = 'manual drag') {
  const r = await fetch('/api/reassign-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, new_crew_id: newCrewId, reason }),
  })
  if (!r.ok) throw new Error(`Reassign failed: ${r.status}`)
  return r.json()
}

export async function suggestSlots({ address, duration_hrs = 2 }) {
  const r = await fetch('/api/suggest-slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, duration_hrs }),
  })
  if (!r.ok) throw new Error(`Suggest failed: ${r.status}`)
  return r.json()
}

// Same as suggestSlots but pre-geocoded by Mapbox on the client —
// lets suggest-slots skip its Nominatim lookup step.
export async function suggestSlotsAt({ address, lat, lng, duration_hrs = 2 }) {
  const r = await fetch('/api/suggest-slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, lat, lng, duration_hrs }),
  })
  if (!r.ok) throw new Error(`Suggest failed: ${r.status}`)
  return r.json()
}
