// Scheduled every 15 min via netlify.toml. Also callable via POST /api/sync-jobtread.
// Pulls JT scheduled tasks for the next 14 days, maps each task to its Sales Rep,
// and enriches with Job Type, Job Status, Project Champion, Lead Score.
// Task category + color come from JT's taskType on each node (real JT task
// types). A regex fallback derives the bucket from task.name if taskType is
// missing on a given node.

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

// Derive a category bucket from the task name — used only as a fallback when
// JT doesn't return a taskType on the node (older tasks without one set).
// Output matches JT's real task-type bucket names so downstream filters and
// the static color map line up.
function deriveTaskCategory(name) {
  if (!name) return 'Uncategorized'
  const n = String(name).toLowerCase()
  if (/\burgent\b|\bmust ?do\b/.test(n))                                                  return '1 Urgent Must Do'
  if (/\bestimate\b|\bbid request\b|\bappt\b|\bappointment\b|\bmeeting\b/.test(n))        return '2 Estimate/Bid Requests'
  if (/\bclose[- ]?out\b|\bpunch ?list\b|\bfinal walk\b|\bclose the deal\b/.test(n))      return '3 Close The Deal!'
  if (/\bjob start\b|\bstart[- ]?up\b|\bkick ?off\b|\btuckpoint|\bmasonry\b|\bwaterproof|\bcaulk|\bseal|\brebuild|\bchimney|\bbrick|\bstone|\bconcrete\b/.test(n)) return '4 Production'
  if (/\bpost[- ]?job\b|\bsatisfaction\b|\bfollow[- ]?up\b|\breview\b/.test(n))           return '5 Post Job Satisfaction'
  return 'Uncategorized'
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
    // Window must match DayStrip (DISPATCH_WINDOW_DAYS in src/lib/utils.js).
    // Keeping this in sync by hand for now since Netlify functions don't share
    // the client bundle. If you change the client constant, change this too.
    const DISPATCH_WINDOW_DAYS = 14
    const end = new Date(today); end.setDate(end.getDate() + (DISPATCH_WINDOW_DAYS - 1))
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
                taskType: { id: {}, name: {}, color: {} },
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
        const task_category = t.taskType?.name || deriveTaskCategory(t.name)
        const task_category_color = t.taskType?.color || null

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
          task_category,                              // JT taskType.name, e.g. "2 Estimate/Bid Requests"
          task_category_color,                        // JT taskType.color hex, e.g. "#2de139"
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
