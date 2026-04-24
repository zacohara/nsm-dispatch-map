import { MARKETS } from '../lib/utils'

// Market lens tabs — "All" (Chicago + Milwaukee focus, outlier pins still
// rendered but don't drive bounds), "Chicago" (hard-scoped), "Milwaukee"
// (hard-scoped). Lives in the header, right side. Persistence is handled
// by App.jsx via localStorage.
//
// Each tab shows a count badge of how many of today's tasks are in that
// market so you can tell at a glance where the workload is.
export default function MarketTabs({ market, onChange, tasks }) {
  // Count visible-day tasks that fall within each market's lat/lng bounds.
  // For `all`, this is just the total visible for symmetry.
  const counts = (() => {
    let chicago = 0, milwaukee = 0, other = 0
    for (const t of tasks || []) {
      if (t.lat == null || t.lng == null) continue
      const lat = t.lat, lng = t.lng
      if (lat > 41.30 && lat < 42.55 && lng > -88.60 && lng < -87.25) chicago++
      else if (lat > 42.55 && lat < 43.85 && lng > -88.50 && lng < -87.50) milwaukee++
      else other++
    }
    return { chicago, milwaukee, all: chicago + milwaukee + other }
  })()

  const tabs = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'chicago', label: 'Chicago', count: counts.chicago },
    { key: 'milwaukee', label: 'Milwaukee', count: counts.milwaukee },
  ]

  return (
    <div className="flex items-center gap-1 bg-mortar-950/60 border border-mortar-800 rounded-lg p-0.5">
      {tabs.map(t => {
        const active = market === t.key
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={[
              'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5',
              active
                ? 'bg-ns-500 text-white shadow-sm shadow-ns-900/50'
                : 'text-mortar-400 hover:text-mortar-200 hover:bg-mortar-900',
            ].join(' ')}
            title={t.key === 'all' ? 'Chicago + Milwaukee focus · outlier pins still shown' : `Focus on ${t.label}`}
          >
            {t.label}
            <span className={[
              'text-[9px] px-1.5 py-0.5 rounded font-mono leading-none',
              active ? 'bg-white/20' : 'bg-mortar-800 text-mortar-500',
            ].join(' ')}>
              {t.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
