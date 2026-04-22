import { todayISO, addDays, fmtDate, isToday } from '../lib/utils'

export default function DayStrip({ date, onChange, taskCountsByDate = {} }) {
  const start = todayISO()
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i))

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-3 border-b border-mortar-800 bg-mortar-900/60 backdrop-blur">
      {days.map(d => {
        const selected = d === date
        const today = isToday(d)
        const count = taskCountsByDate[d] || 0
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={[
              'flex flex-col items-center min-w-[68px] px-3 py-2 rounded-lg border transition-all',
              selected
                ? 'bg-brick-600 border-brick-500 text-white shadow-lg shadow-brick-900/40'
                : 'bg-mortar-900 border-mortar-800 text-mortar-300 hover:bg-mortar-800 hover:border-mortar-500',
            ].join(' ')}
          >
            <span className="text-[10px] uppercase tracking-wider opacity-70">
              {today ? 'Today' : fmtDate(d).split(',')[0]}
            </span>
            <span className="text-lg font-semibold leading-tight">
              {fmtDate(d).split(' ').slice(1).join(' ').replace(',', '')}
            </span>
            <span className={[
              'text-[10px] mt-0.5 px-1.5 rounded',
              count > 0 ? (selected ? 'bg-white/20' : 'bg-mortar-800 text-mortar-300') : 'opacity-0',
            ].join(' ')}>
              {count > 0 ? `${count} task${count === 1 ? '' : 's'}` : '—'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
