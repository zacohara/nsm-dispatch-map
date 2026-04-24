import { useEffect, useState } from 'react'
import { setRepTiers } from '../lib/data'

const TIER_LABELS = {
  1: { label: 'Preferred', color: '#10b981', hint: 'Win ties, beat others by ~8mi' },
  2: { label: 'Standard',  color: '#a0a0a0', hint: 'Default — scored purely on detour' },
  3: { label: 'Backup',    color: '#f59e0b', hint: 'Only surface when detour savings beat ~8mi' },
}

export default function TierAdminModal({ crews, onClose, onFlash, onSaved }) {
  const [draft, setDraft] = useState(() => {
    const m = {}
    for (const c of crews) m[c.id] = c.priority_tier ?? 2
    return m
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const setTier = (id, tier) => setDraft(prev => ({ ...prev, [id]: tier }))

  const dirty = crews.some(c => draft[c.id] !== (c.priority_tier ?? 2))

  const save = async () => {
    if (!dirty) { onClose(); return }
    setSaving(true)
    try {
      const changes = crews
        .filter(c => draft[c.id] !== (c.priority_tier ?? 2))
        .map(c => ({ id: c.id, priority_tier: draft[c.id] }))
      await setRepTiers(changes)
      onFlash?.(`Updated ${changes.length} rep${changes.length === 1 ? '' : 's'}`, 'success')
      onSaved?.()
      onClose()
    } catch (e) {
      onFlash?.(`Save failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[4000] bg-black/70 backdrop-blur-sm grid place-items-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-mortar-950 border border-mortar-800 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-mortar-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display">Admin</div>
            <div className="text-lg font-semibold text-cream">Rep priority tiers</div>
            <div className="text-[11px] text-mortar-500 mt-0.5">
              Tier bias is applied to fit search. Preferred reps get an 8-mile head start.
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-mortar-500 hover:text-mortar-300 text-xl leading-none w-7 h-7 grid place-items-center rounded hover:bg-mortar-800"
          >✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {crews.length === 0 ? (
            <div className="p-6 text-center text-sm text-mortar-500">No active reps.</div>
          ) : (
            <ul className="divide-y divide-mortar-800">
              {crews.map(c => {
                const tier = draft[c.id]
                return (
                  <li key={c.id} className="flex items-center gap-3 px-2 py-2.5">
                    {c.avatar_url ? (
                      <img
                        src={c.avatar_url}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                        style={{ boxShadow: `0 0 0 2px ${c.color}` }}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 text-white font-bold text-xs"
                        style={{ background: c.color }}
                      >
                        {(c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-cream truncate">{c.name}</div>
                      <div className="text-[10px] text-mortar-500 truncate">{c.home_town || '—'}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {[1, 2, 3].map(t => {
                        const meta = TIER_LABELS[t]
                        const active = tier === t
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTier(c.id, t)}
                            title={`${meta.label} — ${meta.hint}`}
                            className={[
                              'px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border transition',
                              active
                                ? 'text-white border-transparent'
                                : 'bg-mortar-900 border-mortar-700 text-mortar-500 hover:border-mortar-500',
                            ].join(' ')}
                            style={active ? { background: meta.color } : undefined}
                          >
                            {meta.label}
                          </button>
                        )
                      })}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-mortar-800 flex items-center justify-between gap-3">
          <div className="text-[11px] text-mortar-500">
            Changes apply to the next fit search.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !saving && onClose()}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded border border-mortar-700 text-mortar-400 hover:text-mortar-200 hover:border-mortar-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="px-3 py-1.5 text-xs rounded bg-ns-500 hover:bg-ns-400 text-white font-semibold disabled:bg-mortar-800 disabled:text-mortar-500 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : (dirty ? 'Save changes' : 'No changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
