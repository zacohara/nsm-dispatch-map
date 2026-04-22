import { useState } from 'react'

// Renders a rep's avatar: JT photo if available, otherwise colored initials disc.
// Used in both LeftPanel and MapView pins.
export default function RepAvatar({ rep, size = 32, showRing = false, ringWidth = 2 }) {
  const [errored, setErrored] = useState(false)
  const color = rep?.color || '#4a9dcf'
  const initials = (rep?.name || '?')
    .split(' ')
    .filter(w => !/^(&|R|O'|III|Jr\.?|Sr\.?)$/i.test(w))
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const ringStyle = showRing
    ? { boxShadow: `0 0 0 ${ringWidth}px ${color}, 0 2px 8px rgba(0,0,0,0.5)` }
    : { boxShadow: '0 2px 6px rgba(0,0,0,0.4)' }

  // Has photo and it hasn't errored — use it with a colored ring
  if (rep?.avatar_url && !errored) {
    return (
      <div
        className="rounded-full overflow-hidden flex-shrink-0 relative"
        style={{
          width: size,
          height: size,
          background: color,
          ...ringStyle,
          border: `${Math.max(1, Math.round(size * 0.06))}px solid ${color}`,
        }}
      >
        <img
          src={rep.avatar_url}
          alt={rep.name || ''}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
          referrerPolicy="no-referrer"
        />
      </div>
    )
  }

  // No photo — colored initials disc
  return (
    <div
      className="rounded-full grid place-items-center flex-shrink-0 font-bold text-white"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: size * 0.4,
        letterSpacing: '0.02em',
        ...ringStyle,
      }}
    >
      {initials}
    </div>
  )
}
