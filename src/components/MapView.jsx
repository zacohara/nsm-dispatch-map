import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'

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

// Pan to the selected task so the glowing pin is centered
function PanToSelected({ lat, lng, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.panTo([lat, lng], { animate: true, duration: 0.5 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// Teardrop pin with initials — DEFAULT MODE (no rep selected)
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

// Clean numbered disc — ROUTE MODE. No avatar. Number in rep's color, white text.
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

// PopupCard — shared popup content including rep avatar
function PopupCard({ task, rep, stopNum, stopTotal }) {
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

  const routePositions = useMemo(() => {
    if (!selectedTasks.length) return null
    return selectedTasks.map(t => [t.lat, t.lng])
  }, [selectedTasks])

  const boundsPoints = useMemo(() => {
    if (selectedTasks.length) return selectedTasks
    const pts = [...visible]
    if (fitResult?.lat != null) pts.push({ lat: fitResult.lat, lng: fitResult.lng })
    return pts
  }, [selectedTasks, visible, fitResult])

  const selectedTaskCoords = useMemo(() => {
    if (!selectedTaskId) return { lat: null, lng: null }
    const t = visible.find(x => x.id === selectedTaskId)
    return t ? { lat: t.lat, lng: t.lng } : { lat: null, lng: null }
  }, [selectedTaskId, visible])

  const defaultCenter = [41.8781, -87.6298]
  const boundsTrigger = `${selectedCrewId || 'all'}|${visible.length}|${fitResult?.lat || ''}`
  const panTrigger = selectedTaskId || ''

  return (
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
              {/* Base path — solid, low opacity */}
              <Polyline
                positions={routePositions}
                pathOptions={{
                  color: selectedCrew?.color || '#4a9dcf',
                  weight: 3,
                  opacity: 0.55,
                }}
              />
              {/* Flowing-dots overlay */}
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

      {/* DEFAULT MODE: small teardrops, no faces */}
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

      {/* Route mode: dim other reps' pins for context */}
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
  )
}
