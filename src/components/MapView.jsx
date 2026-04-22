import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'
import { crewDayMiles, crewDayDriveMin } from '../lib/recommender'

// JT job URL — direct link to open a job in JobTread
const JT_JOB_URL = (jobId) => `https://app.jobtread.com/jobs/${jobId}`

// Fit to a set of points when the set identity changes
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

// Pan to the selected task
function PanToSelected({ lat, lng, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.panTo([lat, lng], { animate: true, duration: 0.5 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// Teardrop pin with initials — DEFAULT MODE
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

// Numbered disc — ROUTE MODE
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

// Home marker — 🏠 pin in rep's color
function homeIcon(color, isActive) {
  const cls = 'home-pin' + (isActive ? ' active' : '')
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="background:${color}"><span>🏠</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

// Fit-search destination pin
function fitIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="fit-pin"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  })
}

// Shared popup content
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
}) {
  const mapRef = useRef(null)

  const visible = useMemo(
    () => tasks.filter(t => t.lat != null && t.lng != null),
    [tasks]
  )

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

  // Route positions — start at home, hit each stop in order, return home
  const routePositions = useMemo(() => {
    if (!selectedTasks.length) return null
    const pts = []
    const hasHome = selectedCrew?.home_lat != null && selectedCrew?.home_lng != null
    if (hasHome) pts.push([selectedCrew.home_lat, selectedCrew.home_lng])
    selectedTasks.forEach(t => pts.push([t.lat, t.lng]))
    if (hasHome) pts.push([selectedCrew.home_lat, selectedCrew.home_lng])
    return pts
  }, [selectedTasks, selectedCrew])

  // All reps that have a home coord — used to render home markers
  const repsWithHome = useMemo(
    () => crews.filter(c => c.home_lat != null && c.home_lng != null),
    [crews]
  )

  const boundsPoints = useMemo(() => {
    if (selectedTasks.length) {
      const pts = [...selectedTasks]
      if (selectedCrew?.home_lat != null) {
        pts.push({ lat: selectedCrew.home_lat, lng: selectedCrew.home_lng })
      }
      return pts
    }
    const pts = [...visible]
    if (fitResult?.lat != null) pts.push({ lat: fitResult.lat, lng: fitResult.lng })
    return pts
  }, [selectedTasks, selectedCrew, visible, fitResult])

  const selectedTaskCoords = useMemo(() => {
    if (!selectedTaskId) return { lat: null, lng: null }
    const t = visible.find(x => x.id === selectedTaskId)
    return t ? { lat: t.lat, lng: t.lng } : { lat: null, lng: null }
  }, [selectedTaskId, visible])

  const defaultCenter = [41.8781, -87.6298]
  const boundsTrigger = `${selectedCrewId || 'all'}|${visible.length}|${fitResult?.lat || ''}`
  const panTrigger = selectedTaskId || ''

  // Route totals for the header strip
  const routeTotals = useMemo(() => {
    if (!selectedCrew || !selectedTasks.length) return null
    const miles = crewDayMiles(selectedCrew, selectedTasks)
    const driveMin = crewDayDriveMin(selectedCrew, selectedTasks)
    const firstTime = selectedTasks[0]?.start_time
    const lastTask = selectedTasks[selectedTasks.length - 1]
    const lastTime = lastTask?.start_time
    return { miles, driveMin, firstTime, lastTime, stops: selectedTasks.length }
  }, [selectedCrew, selectedTasks])

  return (
    <div className="h-full w-full relative">
      {/* Route totals strip */}
      {routeTotals && selectedCrew && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-mortar-900/95 backdrop-blur border border-mortar-800 rounded-lg shadow-xl px-4 py-2 flex items-center gap-4 pointer-events-none"
          style={{ boxShadow: `0 6px 20px rgba(0,0,0,0.5), 0 0 0 1px ${selectedCrew.color}40` }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: selectedCrew.color }}
            />
            <span className="font-display text-sm font-bold text-cream">{selectedCrew.name}</span>
          </div>
          <div className="h-5 w-px bg-mortar-700" />
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-mortar-300">
              <strong className="text-cream">{routeTotals.stops}</strong> stop{routeTotals.stops === 1 ? '' : 's'}
            </span>
            <span className="text-mortar-300">
              <strong className="text-cream">{routeTotals.miles}</strong>mi
            </span>
            <span className="text-mortar-300">
              <strong className="text-cream">{Math.floor(routeTotals.driveMin / 60)}h {routeTotals.driveMin % 60}m</strong> drive
            </span>
            {routeTotals.firstTime && (
              <span className="text-mortar-500">
                {formatTime(routeTotals.firstTime)}–{formatTime(routeTotals.lastTime) || '—'}
              </span>
            )}
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

        {/* Home markers — always rendered (dim the non-selected ones in route mode) */}
        {repsWithHome.map(rep => {
          const isActive = !selectedCrewId || rep.id === selectedCrewId
          return (
            <Marker
              key={`home-${rep.id}`}
              position={[rep.home_lat, rep.home_lng]}
              icon={homeIcon(rep.color, isActive)}
              zIndexOffset={isActive ? 400 : 50}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-bold text-mortar-300">{rep.name}'s home base</div>
                  <div className="text-mortar-500 text-[11px] mt-0.5">{rep.home_town || 'Home'}</div>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {/* ROUTE MODE: numbered discs + flowing-dot line */}
        {selectedCrewId && selectedTasks.length > 0 && (
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
                <Polyline
                  positions={routePositions}
                  pathOptions={{
                    color: selectedCrew?.color || '#4a9dcf',
                    weight: 3,
                    opacity: 0.55,
                  }}
                />
                <Polyline
                  positions={routePositions}
                  pathOptions={{
                    color: selectedCrew?.color || '#4a9dcf',
                    weight: 3,
                    opacity: 0.95,
                    dashArray: '2 14',
                    lineCap: 'round',
                    className: 'route-line-flow',
                  }}
                />
              </>
            )}
          </>
        )}

        {/* DEFAULT MODE: small colored teardrops */}
        {!selectedCrewId && visible.map(t => {
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

        {/* Route mode: dim others */}
        {selectedCrewId && visible
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

        {/* Fit-search destination */}
        {fitResult?.lat != null && (
          <Marker position={[fitResult.lat, fitResult.lng]} icon={fitIcon()} zIndexOffset={2500}>
            <Popup>
              <div className="text-xs">
                <div className="font-bold text-ns-400 mb-1">Lead address</div>
                <div className="text-mortar-300">{fitResult.address}</div>
                <div className="text-[10px] text-mortar-500 mt-1">
                  {fitResult.suggestions?.length || 0} recommended slot{fitResult.suggestions?.length === 1 ? '' : 's'}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        <FitBounds points={boundsPoints} trigger={boundsTrigger} />
        <PanToSelected lat={selectedTaskCoords.lat} lng={selectedTaskCoords.lng} trigger={panTrigger} />
      </MapContainer>
    </div>
  )
}
