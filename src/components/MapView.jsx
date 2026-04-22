import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'

// Fit bounds to whatever tasks are visible
function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]))
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
  }, [points, map])
  return null
}

function buildIcon(color, label, isOrphan) {
  return L.divIcon({
    className: '',
    html: `<div class="dispatch-pin ${isOrphan ? 'orphan' : ''}" style="background:${color}"><span>${label || ''}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  })
}

export default function MapView({
  crews,
  tasks,
  selectedCrewId,
  selectedTaskId,
  onSelectTask,
}) {
  const mapRef = useRef(null)
  const visible = useMemo(
    () => tasks.filter(t => t.lat != null && t.lng != null),
    [tasks]
  )

  // Default view — Chicago if we have no points
  const defaultCenter = [41.8781, -87.6298]

  // Polyline for selected crew's route (sorted by start_time)
  const selectedRoute = useMemo(() => {
    if (!selectedCrewId) return null
    const crew = crews.find(c => c.id === selectedCrewId)
    if (!crew) return null
    const crewTasks = visible
      .filter(t => t.crew_id === selectedCrewId)
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    if (!crewTasks.length) return null
    const pts = []
    if (crew.home_lat != null && crew.home_lng != null) pts.push([crew.home_lat, crew.home_lng])
    crewTasks.forEach(t => pts.push([t.lat, t.lng]))
    return { positions: pts, color: crew.color }
  }, [selectedCrewId, crews, visible])

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

      {visible.map(t => {
        const color = crewColor(t.crew_id, crews)
        const isOrphan = !t.crew_id
        const crewObj = crews.find(c => c.id === t.crew_id)
        const initials = crewObj?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || ''
        const isSelected = t.id === selectedTaskId
        return (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={buildIcon(color, initials, isOrphan)}
            eventHandlers={{ click: () => onSelectTask?.(t.id) }}
            zIndexOffset={isSelected ? 1000 : 0}
          >
            <Popup>
              <div className="text-xs">
                <div className="font-bold text-mortar-300 mb-1">{t.job_name || 'Unnamed job'}</div>
                <div className="text-mortar-500">{t.job_address}</div>
                <div className="mt-2 flex gap-3 text-[11px]">
                  <span><strong>{formatTime(t.start_time)}</strong></span>
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

      {/* Home base markers for active crews */}
      {crews.map(c => c.home_lat != null && c.home_lng != null && (
        <Marker
          key={`hub-${c.id}`}
          position={[c.home_lat, c.home_lng]}
          icon={L.divIcon({
            className: '',
            html: `<div style="width:16px;height:16px;border-radius:50%;background:${c.color};border:3px solid #0e0d0c;box-shadow:0 0 0 2px ${c.color}"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          })}
        >
          <Popup>
            <div className="text-xs font-semibold">{c.name}</div>
            <div className="text-[11px] text-mortar-500">Home base · {c.market}</div>
          </Popup>
        </Marker>
      ))}

      {selectedRoute && (
        <Polyline
          positions={selectedRoute.positions}
          pathOptions={{ color: selectedRoute.color, weight: 3, opacity: 0.7, dashArray: '6, 8' }}
        />
      )}

      <FitBounds points={visible} />
    </MapContainer>
  )
}
