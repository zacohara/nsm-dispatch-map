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

  // Realtime subscription for tasks on the visible date
  useEffect(() => {
    const ch = supabase
      .channel(`dispatch-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_tasks' }, (payload) => {
        const row = payload.new || payload.old
        if (!row || row.scheduled_date !== date) return
        setTasks(prev => {
          if (payload.eventType === 'DELETE') return prev.filter(t => t.id !== row.id)
          const idx = prev.findIndex(t => t.id === row.id)
          if (idx === -1) return [...prev, payload.new].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
          const copy = [...prev]; copy[idx] = payload.new
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

export async function optimizeDay(date) {
  const r = await fetch('/api/optimize-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  })
  if (!r.ok) throw new Error(`Optimize failed: ${r.status}`)
  return r.json()
}
