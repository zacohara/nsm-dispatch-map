// POST /api/set-rep-tier — { updates: [{ id, priority_tier }] }
// Updates dispatch_crews.priority_tier for one or more reps. Server-side
// because anon role has read-only access to dispatch_crews per the RLS
// policies in supabase/migration.sql.

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

  const updates = Array.isArray(body?.updates) ? body.updates : []
  if (updates.length === 0) return json({ error: 'updates[] required' }, 400)

  // Validate each update: id string, tier in {1,2,3}.
  for (const u of updates) {
    if (!u?.id || typeof u.id !== 'string') {
      return json({ error: 'each update requires a string id' }, 400)
    }
    if (![1, 2, 3].includes(u.priority_tier)) {
      return json({ error: `priority_tier must be 1, 2, or 3 (got ${u.priority_tier})` }, 400)
    }
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const results = await Promise.all(updates.map(u =>
    sb.from('dispatch_crews')
      .update({ priority_tier: u.priority_tier })
      .eq('id', u.id)
  ))
  const firstErr = results.find(r => r.error)
  if (firstErr) return json({ error: firstErr.error.message }, 500)

  return json({ success: true, updated: updates.length })
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
