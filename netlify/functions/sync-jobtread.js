// Scheduled every 15 min via netlify.toml. Also callable via POST /api/sync-jobtread.
// Pulls JT scheduled tasks for the next 14 days, maps each task to its Sales Rep,
// and enriches with Job Type, Job Status, Project Champion, Lead Score.
// Also derives a task_category (Estimate / Production / Punch List / Job Start /
// Other) from the task name itself since JT has no structured task-type field.

import { createClient } from '@supabase/supabase-js'

const JT_URL = 'https://api.jobtread.com/pave'

// Job-level custom field IDs we pull on every sync
const FIELD_IDS = {
  SALES_REP:        '22Nx8AjZSNmw',
  JOB_TYPE:         '22Nx8AmPrjTd',
  JOB_STATUS:       '22NzE5gAPktJ',
  PROJECT_CHAMPION: '22Nx8AjgzaWT',
  LEAD_SCORE:       '22NzWRqaNkMB',
}

// Derive a category bucket from the task name. JT has no structured task-type
// field — task.name is the type (e.g., "Masonry Estimate", "Job Close Out/
// Punch List", "Job Start"). We regex-classify once here so the client can
// filter and color-code without re-doing it on every render.
function deriveTaskCategory(name) {
  if (!name) return 'Other'
  const n = String(name).toLowerCase()
  if (/\bestimate\b/.test(n))                                          return 'Estimate'
  if (/\bjob start\b|\bstart[- ]?up\b|\bkick ?off\b/.test(n))          return 'Job Start'
  if (/\bpunch ?list\b|\bclose ?out\b|\bfinal walk\b/.test(n))         return 'Punch List'
  if (/\btuckpoint|\bmasonry\b|\bwaterproof|\bcaulk|\bseal|\brebuild|\bchimney|\bbrick|\bstone|\bconcrete\b/.test(n)) return 'Production'
  if (/\bappt\b|\bappointment\b|\bmeeting\b/.test(n))                  return 'Estimate'
  return 'Other'
}

export default async (req) => {
  const JT_API_KEY = process.env.JT_API_KEY
  const JT_ORG_ID = process.env.JT_ORG_ID
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!JT_API_KEY || !JT_ORG_ID || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Missing env: need JT_API_KEY, JT_ORG_ID, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

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
    const today = new Date()
    const startISO = today.toISOString().slice(0, 10)
    const end = new Date(today); end.setDate(end.getDate() + 14)
    const endISO = end.toISOString().slice(0, 10)

    // Build the `in` clause for all 5 field IDs in object form
    const fieldIdValues = Object.values(FIELD_IDS).map(id => ({ value: id }))

    const allNodes = []
    let page = null
    for (let i = 0; i < 20; i++) {
      const payload = {
        query: {
          $: { grantKey: JT_API_KEY },
          organization: {
            $: { id: JT_ORG_ID },
            tasks: {
              $: {
                size: 100,
                ...(page ? { page } : {}),
                where: {
                  and: [
                    ['isToDo', false],
                    ['startDate', '>=', startISO],
                    ['startDate', '<=', endISO],
                  ],
                },
              },
              nextPage: {},
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
                  location: { id: {}, address: {}, latitude: {}, longitude: {} },
                  customFieldValues: {
                    $: {
                      size: 10,
                      where: {
                        in: [
                          { field: ['customField', 'id'] },
                          fieldIdValues,
                        ],
                      },
                    },
                    nodes: {
                      value: {},
                      customField: { id: {} },
                    },
                  },
                },
              },
            },
          },
        },
      }

      const resp = await fetch(JT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`JT API ${resp.status}: ${errText.slice(0, 300)}`)
      }
      const data = await resp.json()
      const nodes = data?.organization?.tasks?.nodes || []
      allNodes.push(...nodes)
      const next = data?.organization?.tasks?.nextPage
      if (!next) break
      page = next
    }

    if (!allNodes.length) {
      await finalize('ok', 0, null)
      return json({ rows_touched: 0, note: 'no tasks in window' }, 200)
    }

    // Load reps for name → id lookup
    const { data: reps } = await sb.from('dispatch_crews').select('id, name').eq('active', true)
    const repByName = new Map()
    ;(reps || []).forEach(r => repByName.set(normalizeName(r.name), r.id))

    // Build rows — extract all 5 custom field values by field id
    const rows = allNodes
      .filter(t => t.startDate)
      .map(t => {
        const loc = t.job?.location || {}
        const lat = isFiniteNonZero(loc.latitude) ? Number(loc.latitude) : null
        const lng = isFiniteNonZero(loc.longitude) ? Number(loc.longitude) : null

        // Index field values by field id so we can pluck each by name
        const cfvById = new Map()
        ;(t.job?.customFieldValues?.nodes || []).forEach(cfv => {
          const id = cfv?.customField?.id
          if (id) cfvById.set(id, cfv.value ?? null)
        })

        const salesRep        = cfvById.get(FIELD_IDS.SALES_REP)        || null
        const jobType         = cfvById.get(FIELD_IDS.JOB_TYPE)         || null
        const jobStatus       = cfvById.get(FIELD_IDS.JOB_STATUS)       || null
        const projectChampion = cfvById.get(FIELD_IDS.PROJECT_CHAMPION) || null
        const leadScore       = cfvById.get(FIELD_IDS.LEAD_SCORE)       || null

        const crew_id = salesRep ? (repByName.get(normalizeName(salesRep)) || null) : null
        const task_category = deriveTaskCategory(t.name)

        return {
          id: `jt-${t.id}`,
          jt_task_id: t.id,
          jt_job_id: t.job?.id || null,
          job_name: t.job?.name || t.name || 'Unnamed',
          job_address: loc.address || null,
          lat, lng,
          scheduled_date: t.startDate,
          start_time: t.startTime || null,
          duration_hrs: computeDuration(t) || 8,
          crew_id,
          status: t.completed ? 'completed' : 'scheduled',
          notes: t.description || null,
          task_description: t.name || null,          // the actual task name, e.g. "Masonry Estimate"
          task_category,                              // Estimate / Production / Punch List / Job Start / Other
          job_type: jobType,
          job_status: jobStatus,
          project_champion: projectChampion,
          lead_score: leadScore,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      })

    let touched = 0
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200)
      const { error, count } = await sb.from('dispatch_tasks').upsert(batch, { onConflict: 'id', count: 'exact' })
      if (error) throw new Error(`Upsert failed: ${error.message}`)
      touched += (count ?? batch.length)
    }

    const unassigned = rows.filter(r => !r.crew_id).length
    const categoryBreakdown = rows.reduce((acc, r) => {
      acc[r.task_category] = (acc[r.task_category] || 0) + 1
      return acc
    }, {})

    await finalize('ok', touched, null)
    return json({
      rows_touched: touched,
      pulled: allNodes.length,
      unassigned,
      categories: categoryBreakdown,
    }, 200)
  } catch (err) {
    await finalize('error', 0, err.message)
    return json({ error: err.message }, 500)
  }
}

function normalizeName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ').trim()
}

function isFiniteNonZero(n) {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0
}

function computeDuration(t) {
  if (!t.startTime || !t.endTime) return null
  const [sh, sm] = t.startTime.split(':').map(Number)
  const [eh, em] = t.endTime.split(':').map(Number)
  if (isNaN(sh) || isNaN(eh)) return null
  return Math.max(0.5, (eh * 60 + em - sh * 60 - sm) / 60)
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
