import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'

// Fit bounds to whatever points are currently meaningful
function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]))
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 })
  }, [points, map])
  return null
}

// Teardrop pin with initials — default for unselected view
function teardropIcon(color, label, isOrphan, dimmed) {
  const classes = ['dispatch-pin']
  if (isOrphan) classes.push('orphan')
  if (dimmed) classes.push('dimmed')
  return L.divIcon({
    className: '',
    html: `<div class="${classes.join(' ')}" style="background:${color}"><span>${label || ''}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  })
}

// Numbered circular pin for selected-rep route view (1, 2, 3 …)
function numberedIcon(color, n) {
  return L.divIcon({
    className: '',
    html: `<div class="route-pin" style="background:${color}"><span>${n}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  })
}

// Fit-search destination pin
function fitIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="fit-pin"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  })
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

  // Selected rep's stops sorted by start_time — this becomes the numbered route
  const selectedTasks = useMemo(() => {
    if (!selectedCrewId) return []
    return visible
      .filter(t => t.crew_id === selectedCrewId)
      .sort((a, b) => {
        // null start_time → put at end, within that group keep job order
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

  // Bounds target: in route mode → just the route; otherwise → all visible + fit pin
  const boundsPoints = useMemo(() => {
    if (selectedTasks.length) return selectedTasks
    const pts = [...visible]
    if (fitResult?.lat != null) pts.push({ lat: fitResult.lat, lng: fitResult.lng })
    return pts
  }, [selectedTasks, visible, fitResult])

  const defaultCenter = [41.8781, -87.6298] // Chicago

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

      {/* Route mode: show numbered pins + line for selected rep */}
      {selectedCrewId && selectedTasks.length > 0 && (
        <>
          {selectedTasks.map((t, i) => {
            const color = selectedCrew?.color || '#4a9dcf'
            return (
              <Marker
                key={`route-${t.id}`}
                position={[t.lat, t.lng]}
                icon={numberedIcon(color, i + 1)}
                eventHandlers={{ click: () => onSelectTask?.(t.id) }}
                zIndexOffset={500}
              >
                <Popup>
                  <div className="text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-mortar-500">
                      Stop {i + 1} of {selectedTasks.length}
                    </div>
                    <div className="font-bold text-mortar-300 mb-1">{t.job_name || 'Unnamed job'}</div>
                    <div className="text-mortar-500">{t.job_address}</div>
                    <div className="mt-2 flex gap-3 text-[11px]">
                      <span><strong>{formatTime(t.start_time) || '—'}</strong></span>
                      <span>{t.duration_hrs || 8}h</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
          {routePositions && routePositions.length >= 2 && (
            <Polyline
              positions={routePositions}
              pathOptions={{
                color: selectedCrew?.color || '#4a9dcf',
                weight: 4,
                opacity: 0.9,
                className: 'route-line',
              }}
            />
          )}
        </>
      )}

      {/* Default mode: teardrop pins for every task */}
      {!selectedCrewId && visible.map(t => {
        const color = crewColor(t.crew_id, crews)
        const isOrphan = !t.crew_id
        const crewObj = crews.find(c => c.id === t.crew_id)
        const initials = crewObj?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
        const isSelected = t.id === selectedTaskId
        return (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={teardropIcon(color, initials, isOrphan, false)}
            eventHandlers={{ click: () => onSelectTask?.(t.id) }}
            zIndexOffset={isSelected ? 1000 : 0}
          >
            <Popup>
              <div className="text-xs">
                <div className="font-bold text-mortar-300 mb-1">{t.job_name || 'Unnamed job'}</div>
                <div className="text-mortar-500">{t.job_address}</div>
                <div className="mt-2 flex gap-3 text-[11px]">
                  <span><strong>{formatTime(t.start_time) || '—'}</strong></span>
                  <span>{t.duration_hrs || 8}h</span>
                </div>
                <div className="mt-1 text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                    {crewObj?.name || 'Unassigned'}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}

      {/* In route mode, also render dimmed teardrops for other reps so you still see context */}
      {selectedCrewId && visible
        .filter(t => t.crew_id !== selectedCrewId)
        .map(t => {
          const color = crewColor(t.crew_id, crews)
          const isOrphan = !t.crew_id
          const crewObj = crews.find(c => c.id === t.crew_id)
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
                <div className="text-xs">
                  <div className="font-bold text-mortar-300 mb-1">{t.job_name || 'Unnamed job'}</div>
                  <div className="text-mortar-500">{t.job_address}</div>
                  <div className="mt-1 text-[11px]">{crewObj?.name || 'Unassigned'}</div>
                </div>
              </Popup>
            </Marker>
          )
        })}

      {/* Fit-search destination marker */}
      {fitResult?.lat != null && (
        <Marker position={[fitResult.lat, fitResult.lng]} icon={fitIcon()} zIndexOffset={2000}>
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

      <FitBounds points={boundsPoints} />
    </MapContainer>
  )
}
