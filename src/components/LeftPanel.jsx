import { useMemo, useState } from 'react'
import { formatTime } from '../lib/utils'
import { crewDayMiles, crewDayDriveMin } from '../lib/recommender'
import RepAvatar from './RepAvatar'

export default function LeftPanel({
  crews,
  tasks,
  selectedCrewId,
  onSelectCrew,
  selectedTaskId,
  onSelectTask,
  draggedTask,
  onDragStart,
  onDragEnd,
  onDrop,
}) {
  const [showIdle, setShowIdle] = useState(false)

  // Tasks grouped by rep + unassigned bucket
  const groups = useMemo(() => {
    const m = new Map()
    crews.forEach(c => m.set(c.id, []))
    m.set('__unassigned__', [])
    tasks.forEach(t => {
      const k = t.crew_id && m.has(t.crew_id) ? t.crew_id : '__unassigned__'
      m.get(k).push(t)
    })
    return m
  }, [crews, tasks])

  // Split reps into active (has tasks today) and idle (zero tasks)
  const { activeReps, idleReps, unassigned } = useMemo(() => {
    const active = []
    const idle = []
    for (const c of crews) {
      const t = groups.get(c.id) || []
      if (t.length > 0) active.push({ crew: c, tasks: t })
      else idle.push(c)
    }
    // Sort active by task count desc, tiebreak by name
    active.sort((a, b) => b.tasks.length - a.tasks.length || a.crew.name.localeCompare(b.crew.name))
    idle.sort((a, b) => a.name.localeCompare(b.name))
    return {
      activeReps: active,
      idleReps: idle,
      unassigned: groups.get('__unassigned__') || [],
    }
  }, [crews, groups])

  const renderGroup = (crew, crewTasks, isUnassigned = false) => {
    const miles = isUnassigned ? null : crewDayMiles(crew, crewTasks)
    const driveMin = isUnassigned ? null : crewDayDriveMin(crew, crewTasks)
    const isSelected = !isUnassigned && selectedCrewId === crew.id
    const isDropTarget = draggedTask && !isUnassigned && draggedTask.crew_id !== crew.id
    const accent = isUnassigned ? '#6d675d' : crew.color

    return (
      <div
        key={isUnassigned ? '__unassigned__' : crew.id}
        className={[
          'crew-dropzone rounded-lg mb-2 border transition-all overflow-hidden',
          isSelected ? 'border-ns-400 bg-mortar-900 shadow-lg shadow-ns-900/30' : 'border-mortar-800 bg-mortar-900/60 hover:border-mortar-700',
          isDropTarget ? 'drop-target' : '',
        ].join(' ')}
        onDragOver={e => { if (!isUnassigned) e.preventDefault() }}
        onDrop={e => {
          e.preventDefault()
          if (!isUnassigned) onDrop(crew.id)
        }}
      >
        {/* Colored accent bar */}
        {isSelected && (
          <div className="h-0.5" style={{ background: accent }} />
        )}
        <button
          onClick={() => !isUnassigned && onSelectCrew(isSelected ? null : crew.id)}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left"
        >
          {isUnassigned ? (
            <div className="w-8 h-8 rounded-full grid place-items-center flex-shrink-0 bg-mortar-800 border border-mortar-700 text-amber-400 text-sm font-bold">
              ⚠
            </div>
          ) : (
            <RepAvatar rep={crew} size={32} showRing={isSelected} />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-mortar-300 truncate leading-tight">
              {isUnassigned ? 'Unassigned' : crew.name}
            </div>
            {!isUnassigned && crewTasks.length > 0 && miles > 0 && (
              <div className="text-[10px] text-mortar-500 font-mono mt-0.5">
                {miles}mi · {driveMin}m drive
              </div>
            )}
          </div>
          <div
            className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: isUnassigned ? 'rgba(245, 158, 11, 0.15)' : `${accent}22`,
              color: isUnassigned ? '#fbbf24' : accent,
            }}
          >
            {crewTasks.length}
          </div>
        </button>

        {(isSelected || isUnassigned || crewTasks.length <= 3) && crewTasks.length > 0 && (
          <div className="px-2 pb-2 space-y-1">
            {crewTasks.map((t, idx) => {
              const stopNum = !isUnassigned && isSelected ? idx + 1 : null
              return (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => onDragStart(t)}
                  onDragEnd={onDragEnd}
                  onClick={() => onSelectTask(t.id === selectedTaskId ? null : t.id)}
                  className={[
                    'task-card text-xs rounded border pl-2 pr-2 py-1.5 flex items-start gap-2',
                    selectedTaskId === t.id
                      ? 'border-ns-400 bg-mortar-800 shadow-md'
                      : 'border-mortar-800 bg-mortar-950 hover:bg-mortar-800',
                    draggedTask?.id === t.id ? 'dragging' : '',
                  ].join(' ')}
                >
                  {stopNum != null && (
                    <div
                      className="font-display text-xs font-bold w-5 h-5 rounded-full grid place-items-center flex-shrink-0 mt-px"
                      style={{ background: accent, color: 'white' }}
                    >
                      {stopNum}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-mortar-300 truncate">{t.job_name || 'Unnamed job'}</span>
                      <span className="text-mortar-500 font-mono text-[10px] flex-shrink-0">
                        {formatTime(t.start_time)}
                      </span>
                    </div>
                    {t.job_address && (
                      <div className="text-mortar-500 truncate text-[11px] mt-0.5">{t.job_address}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const totalAssigned = activeReps.reduce((s, r) => s + r.tasks.length, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-mortar-800 bg-mortar-900">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400">Sales Reps</div>
            <div className="text-sm font-semibold text-mortar-300">
              {activeReps.length} active · {totalAssigned} task{totalAssigned === 1 ? '' : 's'}
            </div>
          </div>
          <div className="font-display text-xl text-mortar-500 leading-none">//</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {/* Active reps — sorted by task count desc */}
        {activeReps.map(({ crew, tasks }) => renderGroup(crew, tasks))}

        {/* Unassigned — only if populated, after active reps */}
        {unassigned.length > 0 && renderGroup(null, unassigned, true)}

        {/* Idle reps — collapsed section at bottom */}
        {idleReps.length > 0 && (
          <div className="mt-3 pt-2 border-t border-mortar-800">
            <button
              onClick={() => setShowIdle(v => !v)}
              className="w-full flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-mortar-500 hover:text-mortar-300"
            >
              <span>{idleReps.length} rep{idleReps.length === 1 ? '' : 's'} idle today</span>
              <span className="text-sm leading-none">{showIdle ? '−' : '+'}</span>
            </button>
            {showIdle && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 px-1 pb-2">
                {idleReps.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-mortar-900/60 border border-mortar-800 text-[10px] text-mortar-500"
                  >
                    <RepAvatar rep={c} size={16} />
                    <span className="truncate max-w-[110px]">{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
