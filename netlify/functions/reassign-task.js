// POST /api/reassign-task — { task_id, new_crew_id, reason }
// Updates dispatch_tasks.crew_id, writes audit to dispatch_overrides.
// (JT write-back is stubbed — requires vendor/assignee lookup that we'll wire in v1.1)

import { createClient } from '@supabase/supabase-js'

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Missing env' }, 500)
  }

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }

  const { task_id, new_crew_id, reason, actor } = body || {}
  if (!task_id || !new_crew_id) {
    return json({ error: 'task_id and new_crew_id required' }, 400)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Fetch original crew for audit
  const { data: orig, error: selErr } = await sb
    .from('dispatch_tasks')
    .select('id, crew_id')
    .eq('id', task_id)
    .single()
  if (selErr || !orig) return json({ error: selErr?.message || 'Task not found' }, 404)

  // Update crew
  const { error: updErr } = await sb
    .from('dispatch_tasks')
    .update({ crew_id: new_crew_id, updated_at: new Date().toISOString() })
    .eq('id', task_id)
  if (updErr) return json({ error: updErr.message }, 500)

  // Audit row
  await sb.from('dispatch_overrides').insert({
    task_id,
    original_crew_id: orig.crew_id,
    new_crew_id,
    reason: reason || 'manual',
    actor: actor || 'web',
  })

  return json({ success: true, task_id, from: orig.crew_id, to: new_crew_id })
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
