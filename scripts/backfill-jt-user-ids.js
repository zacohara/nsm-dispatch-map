#!/usr/bin/env node
// One-time backfill: match dispatch_crews rows to JT memberships by name,
// populate dispatch_crews.jt_user_id.
//
// Run: node scripts/backfill-jt-user-ids.js
//
// Requires env:
//   JT_API_KEY
//   JT_ORG_ID
//   VITE_SUPABASE_URL (or SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//
// Idempotent — safe to run multiple times. Only updates rows where jt_user_id
// is currently null (so a manual override you set by hand won't be clobbered).

const JT_API_KEY = process.env.JT_API_KEY || '22TGiKuasNuBCh9DF36aQCWsfV6DQdDTwz'
const JT_ORG_ID  = process.env.JT_ORG_ID  || '22NvNEMpKBmy'
const SB_URL     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://wkrtbjvbjebhbcjwurhb.supabase.co'
const SB_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SB_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

function normalizeName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ').trim()
}

async function jt(query) {
  const r = await fetch('https://api.jobtread.com/pave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return r.json()
}

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

async function main() {
  // 1. Pull all memberships from JT (paginated — up to 500 should cover any NSM roster)
  console.log('Fetching JT memberships...')
  const allMembers = []
  let page = null
  for (let i = 0; i < 10; i++) {
    const params = { size: 100 }
    if (page) params.page = page
    const resp = await jt({
      $: { grantKey: JT_API_KEY },
      organization: {
        $: { id: JT_ORG_ID },
        memberships: {
          $: params,
          nextPage: {},
          nodes: { id: {}, user: { id: {}, name: {} } },
        },
      },
    })
    const m = resp?.organization?.memberships
    if (!m) { console.error('Bad JT response:', JSON.stringify(resp).slice(0, 300)); process.exit(1) }
    allMembers.push(...(m.nodes || []))
    if (!m.nextPage) break
    page = m.nextPage
  }
  console.log(`  Got ${allMembers.length} memberships`)

  // Build name-normalized lookup
  const byName = new Map()
  for (const m of allMembers) {
    const u = m?.user
    if (!u?.id || !u?.name) continue
    byName.set(normalizeName(u.name), u.id)
  }

  // 2. Load crews from Supabase
  console.log('Fetching dispatch_crews...')
  const crews = await sb('dispatch_crews?select=id,name,jt_user_id&active=eq.true')
  console.log(`  Got ${crews.length} active crews`)

  // 3. For each crew without jt_user_id, try to match + update
  const updates = []
  const unmatched = []
  for (const c of crews) {
    if (c.jt_user_id) continue
    const key = normalizeName(c.name)
    const userId = byName.get(key)
    if (userId) {
      updates.push({ crewId: c.id, crewName: c.name, userId })
    } else {
      unmatched.push(c.name)
    }
  }

  console.log('\n--- Match report ---')
  console.log(`Matched: ${updates.length}`)
  for (const u of updates) console.log(`  ${u.crewName.padEnd(30)} → ${u.userId}`)
  console.log(`Unmatched: ${unmatched.length}`)
  for (const n of unmatched) console.log(`  ${n}`)
  console.log()

  if (process.argv.includes('--dry-run')) {
    console.log('[dry-run] not writing changes. Re-run without --dry-run to apply.')
    return
  }

  // 4. Apply updates
  for (const u of updates) {
    await sb(`dispatch_crews?id=eq.${u.crewId}`, {
      method: 'PATCH',
      body: JSON.stringify({ jt_user_id: u.userId }),
    })
    console.log(`✔ ${u.crewName}`)
  }
  console.log(`\nDone. ${updates.length} crews updated.`)
}

main().catch(e => { console.error(e); process.exit(1) })
