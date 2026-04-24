import { useEffect, useRef, useState } from 'react'

// Intro splash: plays the North Shore Dispatch intro video full-screen with a
// brick-texture letterbox behind the portrait-oriented video. Auto-dismisses
// when the video ends (~6 seconds). Shown once per browser SESSION — keeps
// the app welcoming without being annoying on manual tab-switches or re-
// focusing during the same workday.
//
// Behavior contract:
//   - First tab in a session → splash plays
//   - Tab stays open → never plays again (flag lives in sessionStorage)
//   - User closes tab / opens a new browser / restarts computer → plays again
//   - If the <video> fails to load (corrupt file, codec issue), fail fast —
//     a 400ms safety timer dismisses so we never strand the user in a
//     blank splash screen.
//
// Styling:
//   - Fullscreen fixed overlay, z-index above everything
//   - Portrait video centered, max-height 92vh
//   - Brick texture surrounding the video (matches app palette)
const SPLASH_KEY = 'nsm-dispatch-intro-played'

export default function IntroSplash() {
  // Read sessionStorage synchronously so the splash is either visible on
  // first paint or never — no flicker where it mounts, flashes, then unmounts.
  const [visible, setVisible] = useState(() => {
    try { return !sessionStorage.getItem(SPLASH_KEY) } catch { return false }
  })
  const videoRef = useRef(null)

  useEffect(() => {
    if (!visible) return
    // Mark as played immediately so a quick refresh doesn't replay it.
    try { sessionStorage.setItem(SPLASH_KEY, '1') } catch {}

    // Safety net: if the <video> element errors or stalls, dismiss after 7s
    // (video is 6.04s — 7s gives a small buffer for startup latency).
    const safety = setTimeout(() => setVisible(false), 7000)
    return () => clearTimeout(safety)
  }, [visible])

  if (!visible) return null

  const dismiss = () => setVisible(false)

  return (
    <div
      className="fixed inset-0 z-[5000] bg-mortar-950 brick-texture flex items-center justify-center"
      // Block pointer events during the intro — no accidental clicks into the
      // app behind it. Video ends → this whole tree unmounts.
    >
      <video
        ref={videoRef}
        src="/intro.mp4"
        poster="/intro-poster.jpg"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={dismiss}
        onError={dismiss}
        className="max-h-[92vh] max-w-[92vw] object-contain"
        style={{
          // Subtle edge glow that picks up the NS blue from the first frame,
          // so the video feels "lit" against the brick letterbox rather than
          // pasted on.
          boxShadow: '0 0 80px 2px rgba(74, 157, 207, 0.25), 0 30px 60px -10px rgba(0,0,0,0.8)',
        }}
      />
    </div>
  )
}
