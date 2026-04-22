import { useState, useMemo, useEffect } from 'react'
import { useDispatchData, triggerSync, reassignTask, optimizeDay } from './lib/data'
import { todayISO, fmtDate, addDays } from './lib/utils'
import { supabase } from './lib/supabase'
import DayStrip from './components/DayStrip'
import LeftPanel from './components/LeftPanel'
import MapView from './components/MapView'
import HealthPanel from './components/HealthPanel'
import OptimizeModal from './components/OptimizeModal'

export default function App() {
  const [date, setDate] = useState(todayISO())
  const [selectedCrewId, setSelectedCrewId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [showOptimize, setShowOptimize] = useState(false)
  const [draggedTask, setDraggedTask] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState(null)
  const [taskCountsByDate, setTaskCountsByDate] = useState({})

  const { crews, tasks, syncInfo, loading, error, reload } = useDispatchData(date)

  // Preload task counts for the 14-day strip
  useEffect(() => {
    const start = todayISO()
    const end = addDays(start, 14)
    supabase
      .from('dispatch_tasks')
      .select('scheduled_date')
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .then(({ data }) => {
        if (!data) return
        const counts = {}
        data.forEach(r => { counts[r.scheduled_date] = (counts[r.scheduled_date] || 0) + 1 })
        setTaskCountsByDate(counts)
      })
  }, [syncInfo?.started_at])

  const flash = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const r = await triggerSync()
      flash(`Synced ${r.rows_touched || 0} tasks`, 'success')
      await reload()
    } catch (e) {
      flash(`Sync error: ${e.message}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleReassign = async (taskId, newCrewId, reason = 'manual') => {
    try {
      await reassignTask(taskId, newCrewId, reason)
      flash('Crew reassigned', 'success')
      await reload()
    } catch (e) {
      flash(`Reassign failed: ${e.message}`, 'error')
    }
  }

  const handleDrop = (newCrewId) => {
    if (draggedTask && draggedTask.crew_id !== newCrewId) {
      handleReassign(draggedTask.id, newCrewId, 'drag')
    }
    setDraggedTask(null)
  }

  return (
    <div className="h-screen flex flex-col bg-mortar-950">
      {/* Header */}
      <header className="px-4 py-2.5 border-b border-mortar-800 bg-mortar-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/ns-mark.png" alt="North Shore" className="w-9 h-9 object-contain" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mortar-500 leading-none">North Shore Masonry</div>
            <div className="text-sm font-bold text-mortar-300 leading-tight">Dispatch</div>
          </div>
        </div>
        <div className="text-xs text-mortar-500">
          {loading ? 'Loading…' : `${fmtDate(date, 'long')} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        </div>
      </header>

      {/* Day strip */}
      <DayStrip date={date} onChange={setDate} taskCountsByDate={taskCountsByDate} />

      {/* Main grid: LeftPanel + MapView */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[320px] flex-shrink-0 border-r border-mortar-800 bg-mortar-950">
          <LeftPanel
            crews={crews}
            tasks={tasks}
            selectedCrewId={selectedCrewId}
            onSelectCrew={setSelectedCrewId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            draggedTask={draggedTask}
            onDragStart={setDraggedTask}
            onDragEnd={() => setDraggedTask(null)}
            onDrop={handleDrop}
          />
        </aside>
        <main className="flex-1 relative">
          <MapView
            crews={crews}
            tasks={tasks}
            selectedCrewId={selectedCrewId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
          {error && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-2 bg-red-900/80 text-red-100 text-xs rounded border border-red-700">
              {error}
            </div>
          )}
          {!loading && tasks.length === 0 && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center text-mortar-500 text-sm">
                <div className="text-3xl mb-2 opacity-50">🗺️</div>
                <div>No tasks scheduled for this day.</div>
                <div className="text-[11px] mt-1">Hit <strong>⟳ Sync JT</strong> below to pull from JobTread.</div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Health + actions bar */}
      <HealthPanel
        crews={crews}
        tasks={tasks}
        syncInfo={syncInfo}
        syncing={syncing}
        onSync={handleSync}
        onOptimize={() => setShowOptimize(true)}
      />

      {/* Optimize modal */}
      <OptimizeModal
        open={showOptimize}
        onClose={() => setShowOptimize(false)}
        crews={crews}
        tasks={tasks}
        onApplySwap={(taskId, toCrewId) => handleReassign(taskId, toCrewId, 'optimizer')}
      />

      {/* Toast */}
      {toast && (
        <div className={[
          'fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-xl z-[3000]',
          toast.type === 'success' ? 'bg-emerald-700' :
          toast.type === 'error'   ? 'bg-red-700' :
          'bg-mortar-800 border border-mortar-500',
        ].join(' ')}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
