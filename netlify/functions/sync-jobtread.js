// Scheduled every 15 min via netlify.toml. Also callable via POST /api/sync-jobtread.
// Pulls JT scheduled tasks for the next 14 days, upserts to dispatch_tasks.

import { createClient } from '@supabase/supabase-js'

const JT_URL = 'https://api.jobtread.com/pave'

export default async (req) => {
  const JT_API_KEY = process.env.JT_API_KEY
  const JT_ORG_ID = process.env.JT_ORG_ID
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!JT_API_KEY || !JT_ORG_ID || !SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing env: need JT_API_KEY, JT_ORG_ID, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Open sync log row
  const { data: logRow } = await sb.from('dispatch_sync_log').insert({ status: 'running' }).select().single()
  const logId = logRow?.id

  const finalize = async (status, rowsTouched, errorMsg) => {
    if (!logId) return
    await sb.from('dispatch_sync_log').update({
      finished_at: new Date().toISOString(),
      rows_touched: rowsTouched,
      status,
      error: errorMsg || null,
    }).eq('id', logId)
  }

  try {
    // Date window: today through +14 days
    const today = new Date()
    const startISO = today.toISOString().slice(0, 10)
    const end = new Date(today); end.setDate(end.getDate() + 14)
    const endISO = end.toISOString().slice(0, 10)

    // Pull scheduled tasks (isToDo: false = scheduled, not to-do)
    // Structure follows JT tasks/schedule shape — we filter for tasks with startDate in window.
    const query = {
      organizationId: JT_ORG_ID,
      query: {
        organization: {
          $: { id: JT_ORG_ID },
          tasks: {
            $: {
              where: [
                ['isToDo', '=', false],
                ['startDate', '>=', startISO],
                ['startDate', '<=', endISO],
              ],
              size: 500,
            },
            nodes: {
              id: {},
              name: {},
              startDate: {},
              startTime: {},
              endDate: {},
              endTime: {},
              completed: {},
              description: {},
              job: {
                id: {},
                name: {},
                location: { name: {}, latitude: {}, longitude: {} },
              },
              assignedTo: { id: {}, name: {} },
            },
          },
        },
      },
    }

    const resp = await fetch(JT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${JT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`JT API ${resp.status}: ${errText.slice(0, 300)}`)
    }
    const data = await resp.json()
    const nodes = data?.organization?.tasks?.nodes || []

    if (!nodes.length) {
      await finalize('ok', 0, null)
      return new Response(JSON.stringify({ rows_touched: 0, note: 'no tasks in window' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Load crews for assignment lookup (match by name)
    const { data: crews } = await sb.from('dispatch_crews').select('id, name, market, home_lat, home_lng')
    const crewByName = new Map()
    ;(crews || []).forEach(c => crewByName.set(c.name.toLowerCase().trim(), c))

    // Map JT task → dispatch_tasks row
    const rows = nodes
      .filter(t => t.startDate)
      .map(t => {
        const loc = t.job?.location || {}
        const lat = typeof loc.latitude === 'number' && loc.latitude !== 0 ? loc.latitude : null
        const lng = typeof loc.longitude === 'number' && loc.longitude !== 0 ? loc.longitude : null

        // Crew assignment — match by assignee name, otherwise leave null (orphan)
        let crew_id = null
        const assigneeName = t.assignedTo?.name?.toLowerCase().trim()
        if (assigneeName && crewByName.has(assigneeName)) {
          crew_id = crewByName.get(assigneeName).id
        } else if (lat && lng) {
          // Fallback: assign to nearest market hub
          crew_id = classifyToHub(lat, lng, crews || [])
        }

        return {
          id: `jt-${t.id}`,
          jt_task_id: t.id,
          jt_job_id: t.job?.id || null,
          job_name: t.job?.name || t.name || 'Unnamed',
          job_address: loc.name || null,
          lat, lng,
          scheduled_date: t.startDate,
          start_time: t.startTime || null,
          duration_hrs: computeDuration(t) || 8,
          crew_id,
          status: t.completed ? 'completed' : 'scheduled',
          notes: t.description || null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      })

    // Upsert in batches of 200
    let touched = 0
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200)
      const { error, count } = await sb.from('dispatch_tasks').upsert(batch, { onConflict: 'id', count: 'exact' })
      if (error) throw new Error(`Upsert failed: ${error.message}`)
      touched += (count ?? batch.length)
    }

    await finalize('ok', touched, null)
    return new Response(JSON.stringify({ rows_touched: touched, pulled: nodes.length }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await finalize('error', 0, err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Pick the nearest hub by haversine
function classifyToHub(lat, lng, crews) {
  const hubs = crews.filter(c => c.id?.startsWith('hub-'))
  if (!hubs.length) return null
  let best = null; let bestD = Infinity
  for (const h of hubs) {
    if (h.home_lat == null) continue
    const d = haversineMi(lat, lng, h.home_lat, h.home_lng)
    if (d < bestD) { bestD = d; best = h.id }
  }
  return best
}

function haversineMi(lat1, lng1, lat2, lng2) {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function computeDuration(t) {
  if (!t.startTime || !t.endTime) return null
  const [sh, sm] = t.startTime.split(':').map(Number)
  const [eh, em] = t.endTime.split(':').map(Number)
  if (isNaN(sh) || isNaN(eh)) return null
  return Math.max(0.5, (eh * 60 + em - sh * 60 - sm) / 60)
}
