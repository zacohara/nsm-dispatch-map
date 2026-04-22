import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { formatTime, crewColor } from '../lib/utils'

// Fit bounds to whatever points are currently meaningful
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

// Pan to selected task marker so it's visible
function PanToSelected({ lat, lng, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.panTo([lat, lng], { animate: true, duration: 0.5 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])
  return null
}

// Initials/teardrop pin — default mode
function teardropIcon(color, label, isOrphan, dimmed, avatarUrl) {
  const classes = ['dispatch-pin']
  if (isOrphan) classes.push('orphan')
  if (dimmed) classes.push('dimmed')

  const inner = avatarUrl
    ? `<img src="${avatarUrl}" class="pin-avatar" onerror="this.style.display='none'" referrerpolicy="no-referrer"/>`
    : `<span>${label || ''}</span>`

  return L.divIcon({
    className: '',
    html: `<div class="${classes.join(' ')}" style="background:${color}">${inner}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  })
}

// Numbered route pin (rep selected). Uses avatar if available, number badge overlay.
function numberedIcon(color, n, avatarUrl, isHighlighted) {
  const size = isHighlighted ? 46 : 38
  const highlightClass = isHighlighted ? ' highlighted' : ''

  const avatarInner = avatarUrl
    ? `<img src="${avatarUrl}" class="pin-avatar-full" onerror="this.parentElement.classList.add('avatar-missing')" referrerpolicy="no-referrer"/>`
    : ''

  return L.divIcon({
    className: '',
    html: `
      <div class="route-pin${highlightClass}" style="background:${color};width:${size}px;height:${size}px">
        ${avatarInner}
        <div class="route-pin-num" style="background:${color}">${n}</div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Fit-search pin
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

  // Selected rep's stops sorted by start_time → becomes the numbered route
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

  // Bounds target: in route mode → just the route; otherwise → all visible + fit pin
  const boundsPoints = useMemo(() => {
    if (selectedTasks.length) return selectedTasks
    const pts = [...visible]
    if (fitResult?.lat != null) pts.push({ lat: fitResult.lat, lng: fitResult.lng })
    return pts
  }, [selectedTasks, visible, fitResult])

  // When a task is selected, find its coordinates so we can pan
  const selectedTaskCoords = useMemo(() => {
    if (!selectedTaskId) return { lat: null, lng: null }
    const t = visible.find(x => x.id === selectedTaskId)
    return t ? { lat: t.lat, lng: t.lng } : { lat: null, lng: null }
  }, [selectedTaskId, visible])

  const defaultCenter = [41.8781, -87.6298] // Chicago

  // Trigger keys change only when the "thing to fit" changes, not on every render
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

      {/* Route mode: numbered pins + animated line */}
      {selectedCrewId && selectedTasks.length > 0 && (
        <>
          {selectedTasks.map((t, i) => {
            const color = selectedCrew?.color || '#4a9dcf'
            const isHighlighted = t.id === selectedTaskId
            return (
              <Marker
                key={`route-${t.id}`}
                position={[t.lat, t.lng]}
                icon={numberedIcon(color, i + 1, selectedCrew?.avatar_url, isHighlighted)}
                eventHandlers={{ click: () => onSelectTask?.(t.id) }}
                zIndexOffset={isHighlighted ? 2000 : 500 + i}
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

      {/* Default mode (no rep selected): teardrop/avatar pins for every task */}
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
            icon={teardropIcon(color, initials, isOrphan, false, crewObj?.avatar_url)}
            eventHandlers={{ click: () => onSelectTask?.(t.id) }}
            zIndexOffset={isSelected ? 2000 : 0}
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

      {/* Route-mode other reps: dimmed teardrops for context */}
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
              icon={teardropIcon(color, initials, isOrphan, true, crewObj?.avatar_url)}
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
  )
}
