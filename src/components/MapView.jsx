import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'
import { crewDayMiles, crewDayDriveMin } from '../lib/recommender'

const JT_JOB_URL = (jobId) => `https://app.jobtread.com/jobs/${jobId}`

// Fit to a set of points when trigger changes
function FitBounds({ points, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]))
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

function PanToSelected({ lat, lng, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.panTo([lat, lng], { animate: true, duration: 0.5 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// Center on a single point at a fixed zoom — used for fit mode so the lead
// address stays the visual focus rather than being lost in wide bounds.
function CenterAt({ lat, lng, zoom = 12, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.setView([lat, lng], zoom, { animate: true, duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// Teardrop pin — default mode
function teardropIcon(color, label, isOrphan, dimmed) {
  const classes = ['dispatch-pin']
  if (isOrphan) classes.push('orphan')
  if (dimmed) classes.push('dimmed')
  return L.divIcon({
    className: '',
    html: `<div class="${classes.join(' ')}" style="background:${color}"><span>${label || ''}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  })
}

// Numbered disc — route mode
function numberedIcon(color, n, isHighlighted) {
  const size = isHighlighted ? 42 : 34
  const cls = 'route-pin' + (isHighlighted ? ' highlighted' : '')
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="background:${color};width:${size}px;height:${size}px"><span>${n}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Home marker
function homeIcon(color, isActive, rank) {
  const cls = 'home-pin' + (isActive ? ' active' : '')
  const rankBadge = rank != null
    ? `<div class="home-rank">${rank}</div>`
    : ''
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="background:${color}"><span>🏠</span>${rankBadge}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

// Fit-search destination pin — bigger & more prominent
function fitIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="fit-pin"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

function PopupCard({ task, rep, stopNum, stopTotal }) {
  const jtUrl = task.jt_job_id ? JT_JOB_URL(task.jt_job_id) : null
  return (
    <div className="popup-card">
      {stopNum != null && (
        <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display mb-1">
          Stop {stopNum} of {stopTotal}
        </div>
      )}
      <div className="font-bold text-mortar-300 text-sm mb-1 leading-tight">
        {task.job_name || 'Unnamed job'}
      </div>
      {task.job_address && (
        <div className="text-mortar-500 text-[11px] mb-2">{task.job_address}</div>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-mortar-800">
        {rep?.avatar_url ? (
          <img
            src={rep.avatar_url}
            alt=""
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
            style={{ boxShadow: `0 0 0 2px ${rep.color}, 0 2px 6px rgba(0,0,0,0.4)` }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 text-white font-bold text-xs"
            style={{ background: rep?.color || '#6d675d' }}
          >
            {(rep?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-mortar-300 truncate">
            {rep?.name || 'Unassigned'}
          </div>
          <div className="text-[10px] text-mortar-500">
            {formatTime(task.start_time) || 'no time'} · {task.duration_hrs || 8}h
          </div>
        </div>
      </div>
      {jtUrl && (
        <a
          href={jtUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-center text-[11px] font-semibold text-ns-400 hover:text-ns-300 pt-2 border-t border-mortar-800"
        >
          Open in JobTread ↗
        </a>
      )}
    </div>
  )
}

export default function MapView({
  crews,
  tasks,
  selectedCrewId,
  selectedTaskId,
  onSelectTask,
  fitResult,
  previewSuggestion, // { rep_id, day, insert_index, day_stops } from FitPanel hover
}) {
  const mapRef = useRef(null)

  const visible = useMemo(
    () => tasks.filter(t => t.lat != null && t.lng != null),
    [tasks]
  )

  // Derive the three visual modes
  const isPreviewMode = Boolean(previewSuggestion)
  const isFitMode = !isPreviewMode && Boolean(fitResult)
  const isRouteMode = !isPreviewMode && !isFitMode && Boolean(selectedCrewId)

  // ========= Preview mode (hovering a suggestion) =========
  // Shows ONLY: previewRep's home + their day_stops + the new lead → detour arc
  const previewRep = useMemo(() => {
    if (!previewSuggestion) return null
    return crews.find(c => c.id === previewSuggestion.rep_id) || null
  }, [previewSuggestion, crews])

  const previewRoutePositions = useMemo(() => {
    if (!previewSuggestion || !previewRep || !fitResult) return null
    const stops = previewSuggestion.day_stops || []
    const hasHome = previewRep.home_lat != null && previewRep.home_lng != null
    const pts = []
    if (hasHome) pts.push([previewRep.home_lat, previewRep.home_lng])

    // Insert the new lead at the specified index, relative to the existing stops
    const insertIdx = previewSuggestion.insert_index ?? stops.length
    for (let i = 0; i < stops.length; i++) {
      if (i === insertIdx) pts.push([fitResult.lat, fitResult.lng])
      pts.push([stops[i].lat, stops[i].lng])
    }
    if (insertIdx >= stops.length) pts.push([fitResult.lat, fitResult.lng])
    if (hasHome) pts.push([previewRep.home_lat, previewRep.home_lng])
    return pts
  }, [previewSuggestion, previewRep, fitResult])

  // ========= Fit mode (drawer open, no hover yet) =========
  // Shows: lead pin + top-5 recommended reps' homes (ranked). Everyone else hidden.
  const recommendedRepIds = useMemo(() => {
    if (!fitResult?.suggestions) return []
    return Array.from(new Set(fitResult.suggestions.map(s => s.rep_id)))
  }, [fitResult])

  const recommendedReps = useMemo(
    () => crews.filter(c => recommendedRepIds.includes(c.id)),
    [crews, recommendedRepIds]
  )

  // ========= Route mode (rep selected) =========
  const selectedTasks = useMemo(() => {
    if (!selectedCrewId) return []
    return visible
      .filter(t => t.crew_id === selectedCrewId)
      .sort((a, b) => {
        const ta = a.start_time || 'zz'
        const tb = b.start_time || 'zz'
        if (ta !== tb) return ta.localeCompare(tb)
        return (a.job_name || '').localeCompare(b.job_name || '')
      })
  }, [selectedCrewId, visible])

  const selectedCrew = useMemo(
    () => crews.find(c => c.id === selectedCrewId) || null,
    [selectedCrewId, crews]
  )

  const routePositions = useMemo(() => {
    if (!selectedTasks.length) return null
    const pts = []
    const hasHome = selectedCrew?.home_lat != null && selectedCrew?.home_lng != null
    if (hasHome) pts.push([selectedCrew.home_lat, selectedCrew.home_lng])
    selectedTasks.forEach(t => pts.push([t.lat, t.lng]))
    if (hasHome) pts.push([selectedCrew.home_lat, selectedCrew.home_lng])
    return pts
  }, [selectedTasks, selectedCrew])

  // ========= All home-bases (default mode only) =========
  const repsWithHome = useMemo(
    () => crews.filter(c => c.home_lat != null && c.home_lng != null),
    [crews]
  )

  // ========= Bounds =========
  const boundsPoints = useMemo(() => {
    if (isPreviewMode && previewRoutePositions) {
      return previewRoutePositions.map(p => ({ lat: p[0], lng: p[1] }))
    }
    if (isFitMode) {
      // Focus: lead + top recommended rep homes + their stops from suggestions
      const pts = [{ lat: fitResult.lat, lng: fitResult.lng }]
      recommendedReps.forEach(r => {
        if (r.home_lat != null) pts.push({ lat: r.home_lat, lng: r.home_lng })
      })
      ;(fitResult.suggestions || []).forEach(s => {
        (s.day_stops || []).forEach(st => {
          if (st.lat != null) pts.push({ lat: st.lat, lng: st.lng })
        })
      })
      return pts
    }
    if (isRouteMode && selectedTasks.length) {
      const pts = [...selectedTasks]
      if (selectedCrew?.home_lat != null) {
        pts.push({ lat: selectedCrew.home_lat, lng: selectedCrew.home_lng })
      }
      return pts
    }
    return visible
  }, [isPreviewMode, isFitMode, isRouteMode, previewRoutePositions, fitResult, recommendedReps, selectedTasks, selectedCrew, visible])

  const selectedTaskCoords = useMemo(() => {
    if (!selectedTaskId) return { lat: null, lng: null }
    const t = visible.find(x => x.id === selectedTaskId)
    return t ? { lat: t.lat, lng: t.lng } : { lat: null, lng: null }
  }, [selectedTaskId, visible])

  const defaultCenter = [41.8781, -87.6298]
  const boundsTrigger = [
    isPreviewMode ? `pv-${previewSuggestion?.rep_id}-${previewSuggestion?.day}-${previewSuggestion?.insert_index}` : '',
    isFitMode ? `fit-${fitResult?.lat}` : '',
    isRouteMode ? `rt-${selectedCrewId}` : '',
    !isPreviewMode && !isFitMode && !isRouteMode ? `def-${visible.length}` : '',
  ].join('|')
  const panTrigger = selectedTaskId || ''

  // Route totals (route mode only)
  const routeTotals = useMemo(() => {
    if (!isRouteMode || !selectedCrew || !selectedTasks.length) return null
    const miles = crewDayMiles(selectedCrew, selectedTasks)
    const driveMin = crewDayDriveMin(selectedCrew, selectedTasks)
    const firstTime = selectedTasks[0]?.start_time
    const lastTime = selectedTasks[selectedTasks.length - 1]?.start_time
    return { miles, driveMin, firstTime, lastTime, stops: selectedTasks.length }
  }, [isRouteMode, selectedCrew, selectedTasks])

  return (
    <div className="h-full w-full relative">
      {/* Route totals strip (route mode only) */}
      {routeTotals && selectedCrew && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-mortar-900/95 backdrop-blur border border-mortar-800 rounded-lg shadow-xl px-4 py-2 flex items-center gap-4 pointer-events-none"
          style={{ boxShadow: `0 6px 20px rgba(0,0,0,0.5), 0 0 0 1px ${selectedCrew.color}40` }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: selectedCrew.color }} />
            <span className="font-display text-sm font-bold text-cream">{selectedCrew.name}</span>
          </div>
          <div className="h-5 w-px bg-mortar-700" />
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-mortar-300"><strong className="text-cream">{routeTotals.stops}</strong> stop{routeTotals.stops === 1 ? '' : 's'}</span>
            <span className="text-mortar-300"><strong className="text-cream">{routeTotals.miles}</strong>mi</span>
            <span className="text-mortar-300"><strong className="text-cream">{Math.floor(routeTotals.driveMin / 60)}h {routeTotals.driveMin % 60}m</strong> drive</span>
            {routeTotals.firstTime && (
              <span className="text-mortar-500">
                {formatTime(routeTotals.firstTime)}–{formatTime(routeTotals.lastTime) || '—'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Preview banner (hover mode) */}
      {isPreviewMode && previewRep && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-mortar-900/95 backdrop-blur border rounded-lg shadow-xl px-4 py-2 flex items-center gap-3 pointer-events-none"
          style={{ borderColor: previewRep.color }}
        >
          <div className="text-[10px] uppercase tracking-[0.2em] text-ns-400 font-display">Preview</div>
          <div className="h-4 w-px bg-mortar-700" />
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: previewRep.color }} />
            <span className="font-semibold text-cream text-sm">{previewRep.name}</span>
            <span className="text-mortar-500 text-[11px]">
              · {previewSuggestion.day_label} · +{previewSuggestion.added_miles}mi detour
            </span>
          </div>
        </div>
      )}

      <MapContainer
        ref={mapRef}
        center={defaultCenter}
        zoom={10}
        className="h-full w-full"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* ========= HOME MARKERS ========= */}
        {/* Preview mode: just the previewed rep's home */}
        {isPreviewMode && previewRep?.home_lat != null && (
          <Marker
            position={[previewRep.home_lat, previewRep.home_lng]}
            icon={homeIcon(previewRep.color, true)}
            zIndexOffset={400}
          >
            <Popup>
              <div className="text-xs font-bold text-mortar-300">{previewRep.name}'s home base</div>
              <div className="text-[11px] text-mortar-500">{previewRep.home_town}</div>
            </Popup>
          </Marker>
        )}

        {/* Fit mode: top-5 recommended reps' homes, ranked */}
        {isFitMode && recommendedReps.map(rep => {
          const rank = recommendedRepIds.indexOf(rep.id) + 1
          return rep.home_lat != null && (
            <Marker
              key={`home-${rep.id}`}
              position={[rep.home_lat, rep.home_lng]}
              icon={homeIcon(rep.color, true, rank)}
              zIndexOffset={500 - rank}
            >
              <Popup>
                <div className="text-xs font-bold text-mortar-300">
                  #{rank} — {rep.name}'s home base
                </div>
                <div className="text-[11px] text-mortar-500">{rep.home_town}</div>
              </Popup>
            </Marker>
          )
        })}

        {/* Route mode: selected rep's home only */}
        {isRouteMode && selectedCrew?.home_lat != null && (
          <Marker
            position={[selectedCrew.home_lat, selectedCrew.home_lng]}
            icon={homeIcon(selectedCrew.color, true)}
            zIndexOffset={400}
          >
            <Popup>
              <div className="text-xs font-bold text-mortar-300">{selectedCrew.name}'s home base</div>
              <div className="text-[11px] text-mortar-500">{selectedCrew.home_town}</div>
            </Popup>
          </Marker>
        )}

        {/* Default mode: all 7 homes */}
        {!isPreviewMode && !isFitMode && !isRouteMode && repsWithHome.map(rep => (
          <Marker
            key={`home-${rep.id}`}
            position={[rep.home_lat, rep.home_lng]}
            icon={homeIcon(rep.color, true)}
            zIndexOffset={100}
          >
            <Popup>
              <div className="text-xs font-bold text-mortar-300">{rep.name}'s home base</div>
              <div className="text-[11px] text-mortar-500">{rep.home_town}</div>
            </Popup>
          </Marker>
        ))}

        {/* ========= ROUTE LINES & PINS ========= */}

        {/* Preview mode: dashed detour + numbered stops (with NEW marker inserted) */}
        {isPreviewMode && previewRep && previewRoutePositions && previewRoutePositions.length >= 2 && (
          <>
            <Polyline
              positions={previewRoutePositions}
              pathOptions={{
                color: previewRep.color,
                weight: 3,
                opacity: 0.55,
              }}
            />
            <Polyline
              positions={previewRoutePositions}
              pathOptions={{
                color: previewRep.color,
                weight: 3,
                opacity: 0.95,
                dashArray: '2 14',
                lineCap: 'round',
                className: 'route-line-flow',
              }}
            />
            {/* Render numbered pins for existing stops + the NEW slot */}
            {(() => {
              const stops = previewSuggestion.day_stops || []
              const insertIdx = previewSuggestion.insert_index ?? stops.length
              const combined = []
              for (let i = 0; i < stops.length; i++) {
                if (i === insertIdx) {
                  combined.push({ isNew: true, lat: fitResult.lat, lng: fitResult.lng })
                }
                combined.push({ isNew: false, ...stops[i] })
              }
              if (insertIdx >= stops.length) {
                combined.push({ isNew: true, lat: fitResult.lat, lng: fitResult.lng })
              }
              return combined.map((item, idx) => (
                <Marker
                  key={item.isNew ? 'preview-new' : `preview-stop-${item.id}`}
                  position={[item.lat, item.lng]}
                  icon={item.isNew
                    ? L.divIcon({
                        className: '',
                        html: `<div class="route-pin new-slot" style="background:#4a9dcf;width:44px;height:44px;"><span>NEW</span></div>`,
                        iconSize: [44, 44],
                        iconAnchor: [22, 22],
                        popupAnchor: [0, -22],
                      })
                    : numberedIcon(previewRep.color, idx + 1, false)
                  }
                  zIndexOffset={item.isNew ? 3000 : 500 + idx}
                >
                  <Popup>
                    {item.isNew ? (
                      <div className="text-xs">
                        <div className="font-bold text-ns-400">New lead slot</div>
                        <div className="text-mortar-300 mt-1">{fitResult.address}</div>
                      </div>
                    ) : (
                      <div className="text-xs">
                        <div className="font-bold text-mortar-300">{item.job_name}</div>
                        <div className="text-mortar-500">{item.job_address}</div>
                        <div className="text-[10px] text-mortar-500 mt-1">
                          {formatTime(item.start_time) || 'no time'}
                        </div>
                      </div>
                    )}
                  </Popup>
                </Marker>
              ))
            })()}
          </>
        )}

        {/* Fit mode: show each recommended rep's stops for their suggested day (dim) */}
        {isFitMode && fitResult.suggestions?.map((s, i) => {
          const rep = crews.find(c => c.id === s.rep_id)
          if (!rep) return null
          return (s.day_stops || []).map((stop, stopIdx) => {
            const initials = rep.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
            return (
              <Marker
                key={`fit-stop-${s.rep_id}-${s.day}-${stop.id}`}
                position={[stop.lat, stop.lng]}
                icon={teardropIcon(rep.color, initials, false, false)}
                zIndexOffset={100}
              >
                <Popup>
                  <div className="text-xs">
                    <div className="font-bold text-mortar-300">{stop.job_name}</div>
                    <div className="text-mortar-500">{stop.job_address}</div>
                    <div className="text-[10px] text-mortar-500 mt-1">
                      {rep.name} · {s.day_label}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })
        })}

        {/* Route mode: numbered pins + animated line */}
        {isRouteMode && selectedTasks.length > 0 && (
          <>
            {selectedTasks.map((t, i) => {
              const color = selectedCrew?.color || '#4a9dcf'
              const isHighlighted = t.id === selectedTaskId
              return (
                <Marker
                  key={`route-${t.id}`}
                  position={[t.lat, t.lng]}
                  icon={numberedIcon(color, i + 1, isHighlighted)}
                  eventHandlers={{ click: () => onSelectTask?.(t.id) }}
                  zIndexOffset={isHighlighted ? 2000 : 500 + i}
                >
                  <Popup>
                    <PopupCard task={t} rep={selectedCrew} stopNum={i + 1} stopTotal={selectedTasks.length} />
                  </Popup>
                </Marker>
              )
            })}
            {routePositions && routePositions.length >= 2 && (
              <>
                <Polyline positions={routePositions} pathOptions={{ color: selectedCrew?.color || '#4a9dcf', weight: 3, opacity: 0.55 }} />
                <Polyline positions={routePositions} pathOptions={{ color: selectedCrew?.color || '#4a9dcf', weight: 3, opacity: 0.95, dashArray: '2 14', lineCap: 'round', className: 'route-line-flow' }} />
              </>
            )}
          </>
        )}

        {/* Default mode: all visible task pins */}
        {!isPreviewMode && !isFitMode && !isRouteMode && visible.map(t => {
          const crewObj = crews.find(c => c.id === t.crew_id)
          const color = crewColor(t.crew_id, crews)
          const isOrphan = !t.crew_id
          const initials = crewObj?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
          const isSelected = t.id === selectedTaskId
          return (
            <Marker
              key={t.id}
              position={[t.lat, t.lng]}
              icon={teardropIcon(color, initials, isOrphan, false)}
              eventHandlers={{ click: () => onSelectTask?.(t.id) }}
              zIndexOffset={isSelected ? 2000 : 0}
            >
              <Popup>
                <PopupCard task={t} rep={crewObj} />
              </Popup>
            </Marker>
          )
        })}

        {/* Route mode: dim other reps' pins */}
        {isRouteMode && visible
          .filter(t => t.crew_id !== selectedCrewId)
          .map(t => {
            const crewObj = crews.find(c => c.id === t.crew_id)
            const color = crewColor(t.crew_id, crews)
            const isOrphan = !t.crew_id
            const initials = crewObj?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
            return (
              <Marker
                key={`dim-${t.id}`}
                position={[t.lat, t.lng]}
                icon={teardropIcon(color, initials, isOrphan, true)}
                eventHandlers={{ click: () => onSelectTask?.(t.id) }}
                zIndexOffset={0}
              >
                <Popup>
                  <PopupCard task={t} rep={crewObj} />
                </Popup>
              </Marker>
            )
          })}

        {/* Fit-search destination pin (any mode that includes fitResult) */}
        {fitResult?.lat != null && !isPreviewMode && (
          <Marker position={[fitResult.lat, fitResult.lng]} icon={fitIcon()} zIndexOffset={2500}>
            <Popup>
              <div className="text-xs">
                <div className="font-bold text-ns-400 mb-1">New lead</div>
                <div className="text-mortar-300">{fitResult.address}</div>
                <div className="text-[10px] text-mortar-500 mt-1">
                  {fitResult.suggestions?.length || 0} recommended slot{fitResult.suggestions?.length === 1 ? '' : 's'} — hover a suggestion to preview
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Fit mode → center tightly on the lead. Other modes → fit bounds. */}
        {isFitMode ? (
          <CenterAt
            lat={fitResult.lat}
            lng={fitResult.lng}
            zoom={12}
            trigger={`fit-${fitResult.lat}-${fitResult.lng}`}
          />
        ) : (
          <FitBounds points={boundsPoints} trigger={boundsTrigger} />
        )}
        <PanToSelected lat={selectedTaskCoords.lat} lng={selectedTaskCoords.lng} trigger={panTrigger} />
      </MapContainer>
    </div>
  )
}
