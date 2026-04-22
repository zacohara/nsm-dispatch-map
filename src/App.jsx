import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDispatchData, triggerSync, reassignTask } from './lib/data'
import { todayISO, fmtDate, addDays } from './lib/utils'
import { supabase } from './lib/supabase'
import DayStrip from './components/DayStrip'
import LeftPanel from './components/LeftPanel'
import MapView from './components/MapView'
import HealthPanel from './components/HealthPanel'
import FitPanel from './components/FitPanel'
import SuggestPanel from './components/SuggestPanel'
import FilterBar from './components/FilterBar'

export default function App() {
  const [date, setDate] = useState(todayISO())
  const [selectedCrewId, setSelectedCrewId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState(null)
  const [taskCountsByDate, setTaskCountsByDate] = useState({})
  const [fitResult, setFitResult] = useState(null)
  const [previewSuggestion, setPreviewSuggestion] = useState(null)
  const [stripTick, setStripTick] = useState(0)
  // Filter state — empty set means "show all". Adding a category to the set
  // makes that the active filter (additive — can pick multiple).
  const [activeCategories, setActiveCategories] = useState(() => new Set())

  const { crews, tasks, syncInfo, loading, error, reload } = useDispatchData(date)

  // Apply the category filter. Empty set → all tasks visible.
  const filteredTasks = useMemo(() => {
    if (activeCategories.size === 0) return tasks
    return tasks.filter(t => activeCategories.has(t.task_category || 'Other'))
  }, [tasks, activeCategories])

  const toggleCategory = useCallback((cat) => {
    setActiveCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
    // Clear selection — selected items may be filtered out
    setSelectedTaskId(null)
  }, [])

  const resetCategories = useCallback(() => {
    setActiveCategories(new Set())
  }, [])

  // Wrap setDate to clear rep/task selections when switching days
  const handleDateChange = useCallback((next) => {
    if (next !== date) {
      setSelectedCrewId(null)
      setSelectedTaskId(null)
    }
    setDate(next)
  }, [date])

  // Preload task counts for the 14-day strip — refreshes on sync AND on any task mutation
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
  }, [syncInfo?.started_at, stripTick])

  // Global ESC — clears preview → fit pin → selected task → selected rep
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (previewSuggestion) { setPreviewSuggestion(null); return }
      if (fitResult) { setFitResult(null); return }
      if (selectedTaskId) { setSelectedTaskId(null); return }
      if (selectedCrewId) { setSelectedCrewId(null); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewSuggestion, fitResult, selectedTaskId, selectedCrewId])

  const flash = (msg, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const r = await triggerSync()
      if (r.rows_touched > 0) {
        flash(`Synced ${r.rows_touched} task${r.rows_touched === 1 ? '' : 's'}`, 'success')
      } else {
        flash('Already up to date', 'info')
      }
      await reload()
      setStripTick(t => t + 1)
    } catch (e) {
      flash(`Sync error: ${e.message}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const handleReassign = async (taskId, newCrewId, reason = 'manual') => {
    try {
      await reassignTask(taskId, newCrewId, reason)
      await reload()
      setStripTick(t => t + 1)
    } catch (e) {
      flash(`Reassign failed: ${e.message}`, 'error')
      throw e
    }
  }

  return (
    <div className="h-screen flex flex-col bg-mortar-950">
      {/* Header */}
      <header className="px-5 py-3 brick-texture flex items-center justify-between border-b border-mortar-800 relative">
        <div className="flex items-center gap-3">
          <img src="/ns-mark.png" alt="" className="w-11 h-11 object-contain drop-shadow-lg" />
          <div className="flex flex-col leading-none">
            <div className="font-display text-cream text-[24px] tracking-tight">
              North Shore <span className="text-ns-400">Dispatch</span>
            </div>
            <div className="mt-1 since-stamp">
              <span className="bar" /> Since 1978 <span className="bar" />
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-[0.25em] text-mortar-500 font-display">Today</div>
          <div className="text-sm font-semibold text-mortar-300">
            {loading
              ? 'Loading…'
              : activeCategories.size > 0
                ? `${fmtDate(date, 'long')} · ${filteredTasks.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}`
                : `${fmtDate(date, 'long')} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </header>
      <div className="brand-seam" />

      {/* Day strip */}
      <DayStrip date={date} onChange={handleDateChange} taskCountsByDate={taskCountsByDate} />

      {/* Category filter chips — only appears if today has tasks with categories */}
      <FilterBar
        tasks={tasks}
        activeCategories={activeCategories}
        onToggle={toggleCategory}
        onReset={resetCategories}
      />

      {/* Main grid */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[320px] flex-shrink-0 border-r border-mortar-800 bg-mortar-950">
          <LeftPanel
            crews={crews}
            tasks={filteredTasks}
            selectedCrewId={selectedCrewId}
            onSelectCrew={setSelectedCrewId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            fitResult={fitResult}
            onExitFitMode={() => { setFitResult(null); setPreviewSuggestion(null) }}
          />
        </aside>
        <main className="flex-1 relative">
          <MapView
            crews={crews}
            tasks={filteredTasks}
            selectedCrewId={selectedCrewId}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            fitResult={fitResult}
            previewSuggestion={previewSuggestion}
          />
          {error && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-2 bg-red-900/80 text-red-100 text-xs rounded border border-red-700 z-[600]">
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

      <FitPanel
        crews={crews}
        onResult={setFitResult}
        currentResult={fitResult}
        onClear={() => { setFitResult(null); setPreviewSuggestion(null) }}
        onFlash={flash}
        onPreviewSuggestion={setPreviewSuggestion}
        onSelectRep={setSelectedCrewId}
      />
      <HealthPanel
        crews={crews}
        tasks={tasks}
        syncInfo={syncInfo}
        syncing={syncing}
        onSync={handleSync}
      />

      <SuggestPanel
        crews={crews}
        tasks={tasks}
        onApplySwap={handleReassign}
        onFlash={flash}
      />

      {toast && (
        <div className={[
          'fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-xl z-[3000]',
          toast.type === 'success' ? 'bg-emerald-700' :
          toast.type === 'error'   ? 'bg-red-700' :
          'bg-ns-600 border border-ns-400',
        ].join(' ')}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
