import { useMemo } from 'react'
import { CATEGORY_COLORS, CATEGORY_ORDER, CATEGORY_SHORT, resolveCategoryColor } from './MapView'

export default function FilterBar({ tasks, activeCategories, onToggle, onReset }) {
  // Count tasks by category for today — drives the badge number on each chip
  const counts = useMemo(() => {
    const c = {}
    tasks.forEach(t => {
      const k = t.task_category || 'Uncategorized'
      c[k] = (c[k] || 0) + 1
    })
    return c
  }, [tasks])

  // Pull the chip color from the first task of each bucket so we honor the
  // synced JT hex on the row; fall back to the static map if nothing in bucket.
  const colorByCat = useMemo(() => {
    const m = {}
    tasks.forEach(t => {
      const k = t.task_category || 'Uncategorized'
      if (!m[k]) m[k] = resolveCategoryColor(t)
    })
    return m
  }, [tasks])

  // Only show chips for categories that have at least one task today,
  // plus a persistent 'All' chip at the far left
  const visibleCats = CATEGORY_ORDER.filter(cat => counts[cat] > 0)
  const allActive = activeCategories.size === 0

  if (!visibleCats.length) return null

  return (
    <div className="px-3 py-1.5 border-b border-mortar-800 bg-mortar-950 flex items-center gap-1.5 overflow-x-auto">
      <span className="text-[9px] uppercase tracking-[0.2em] text-mortar-500 font-display flex-shrink-0 mr-1">
        Filter
      </span>
      <button
        onClick={onReset}
        className={[
          'flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold transition',
          allActive
            ? 'bg-ns-500 text-white'
            : 'bg-mortar-900 border border-mortar-700 text-mortar-300 hover:border-mortar-500',
        ].join(' ')}
      >
        All
        <span className="ml-1 text-[10px] opacity-70">{tasks.length}</span>
      </button>
      {visibleCats.map(cat => {
        const color = colorByCat[cat] || CATEGORY_COLORS[cat] || CATEGORY_COLORS['Uncategorized']
        const label = CATEGORY_SHORT[cat] || cat
        const isActive = activeCategories.has(cat)
        const isDisabled = !allActive && !isActive
        return (
          <button
            key={cat}
            onClick={() => onToggle(cat)}
            className={[
              'flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold transition flex items-center gap-1.5',
              isActive ? 'text-white' : isDisabled ? 'text-mortar-500 border border-mortar-800' : 'text-mortar-300 border border-mortar-700',
            ].join(' ')}
            style={isActive ? {
              background: color,
              boxShadow: `0 0 0 1px ${color}, 0 2px 6px ${color}55`,
            } : {
              background: 'var(--mortar-900)',
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: color, opacity: isDisabled ? 0.4 : 1 }}
            />
            {label}
            <span className="text-[10px] opacity-75">{counts[cat]}</span>
          </button>
        )
      })}
    </div>
  )
}
