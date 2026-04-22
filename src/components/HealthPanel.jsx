import { useMemo } from 'react'
import { dayHealth } from '../lib/recommender'

function timeAgo(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const now = Date.now()
  const mins = Math.floor((now - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function HealthPanel({ crews, tasks, syncInfo, syncing, onSync, onOptimize }) {
  const health = useMemo(() => dayHealth(crews, tasks), [crews, tasks])

  const scoreColor =
    health.score >= 85 ? 'text-emerald-400' :
    health.score >= 65 ? 'text-amber-400' :
    'text-red-400'

  return (
    <div className="px-3 py-2 border-t border-mortar-800 bg-mortar-900/60 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wider text-mortar-500">Day health</div>
        <div className={`text-2xl font-bold ${scoreColor} leading-none`}>{health.score}</div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-mortar-300">
        {health.orphans > 0 && (
          <span className="text-amber-400">⚠ {health.orphans} unassigned</span>
        )}
        {health.crossMarket > 0 && (
          <span className="text-orange-400">⚑ {health.crossMarket} far from hub</span>
        )}
        <span className="text-mortar-500">⌀ {health.avgMiles}mi/rep</span>
      </div>

      <div className="flex-1" />

      <div className="text-[10px] text-mortar-500">
        Last sync: {timeAgo(syncInfo?.started_at)}
        {syncInfo?.rows_touched != null && ` · ${syncInfo.rows_touched} rows`}
      </div>

      <button
        onClick={onSync}
        disabled={syncing}
        className="px-2.5 py-1 text-xs rounded border border-mortar-800 bg-mortar-900 hover:bg-mortar-800 text-mortar-300 disabled:opacity-50"
      >
        {syncing ? '⟳ Syncing…' : '⟳ Sync JT'}
      </button>
    </div>
  )
}
