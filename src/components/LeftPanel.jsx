import { formatTime, crewColor } from '../lib/utils'
import { crewDayMiles, crewDayDriveMin } from '../lib/recommender'

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
  // Group tasks by crew (with "Unassigned" bucket)
  const groups = new Map()
  crews.forEach(c => groups.set(c.id, []))
  groups.set('__unassigned__', [])
  tasks.forEach(t => {
    const k = t.crew_id && groups.has(t.crew_id) ? t.crew_id : '__unassigned__'
    groups.get(k).push(t)
  })

  const renderGroup = (crew, crewTasks, isUnassigned = false) => {
    const miles = isUnassigned ? null : crewDayMiles(crew, crewTasks)
    const driveMin = isUnassigned ? null : crewDayDriveMin(crew, crewTasks)
    const isSelected = !isUnassigned && selectedCrewId === crew.id
    const isDropTarget = draggedTask && !isUnassigned && draggedTask.crew_id !== crew.id

    return (
      <div
        key={isUnassigned ? '__unassigned__' : crew.id}
        className={[
          'crew-dropzone rounded-lg mb-2 border transition-colors',
          isSelected ? 'border-ns-400 bg-mortar-900' : 'border-mortar-800 bg-mortar-900/60',
          isDropTarget ? 'drop-target' : '',
        ].join(' ')}
        onDragOver={e => { if (!isUnassigned) e.preventDefault() }}
        onDrop={e => {
          e.preventDefault()
          if (!isUnassigned) onDrop(crew.id)
        }}
      >
        <button
          onClick={() => !isUnassigned && onSelectCrew(isSelected ? null : crew.id)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left"
        >
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ background: isUnassigned ? '#6d675d' : crew.color }}
          />
          <span className="flex-1 text-sm font-semibold text-mortar-300">
            {isUnassigned ? '⚠ Unassigned' : crew.name}
          </span>
          <span className="text-[10px] text-mortar-500 font-mono">
            {crewTasks.length} {!isUnassigned && miles > 0 ? `· ${miles}mi · ${driveMin}m` : ''}
          </span>
        </button>

        {(isSelected || isUnassigned || crewTasks.length <= 4) && crewTasks.length > 0 && (
          <div className="px-2 pb-2 space-y-1">
            {crewTasks.map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={() => onDragStart(t)}
                onDragEnd={onDragEnd}
                onClick={() => onSelectTask(t.id === selectedTaskId ? null : t.id)}
                className={[
                  'task-card text-xs rounded border px-2 py-1.5',
                  selectedTaskId === t.id
                    ? 'border-ns-400 bg-mortar-800'
                    : 'border-mortar-800 bg-mortar-950 hover:bg-mortar-800',
                  draggedTask?.id === t.id ? 'dragging' : '',
                ].join(' ')}
              >
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
            ))}
          </div>
        )}
      </div>
    )
  }

  const unassigned = groups.get('__unassigned__') || []

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-mortar-800">
        <div className="text-[10px] uppercase tracking-wider text-mortar-500">Sales Reps</div>
        <div className="text-sm font-semibold text-mortar-300">
          {crews.length} active · {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {unassigned.length > 0 && renderGroup(null, unassigned, true)}
        {crews.map(crew => renderGroup(crew, groups.get(crew.id) || []))}
      </div>
    </div>
  )
}
