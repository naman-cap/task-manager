import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const JIRA_URL   = 'https://capillarytech.atlassian.net'
const JIRA_EMAIL = Deno.env.get('JIRA_EMAIL') ?? ''
const JIRA_TOKEN = Deno.env.get('JIRA_TOKEN') ?? ''
const JIRA_JQL   = 'created >= -15d AND project = CAP AND issuetype = Document ORDER BY created DESC'
const MEMBERS    = ['neeraj', 'divya', 'madhurima', 'george', 'naman']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jiraAuth() {
  return 'Basic ' + btoa(`${JIRA_EMAIL}:${JIRA_TOKEN}`)
}

// Map Jira status → app status  (CAP_StoryWorkflow_v3)
// Jira statuses       → App
// OPEN                → not-started
// BACKLOG             → not-started
// DETAILING IN PROG…  → wip
// IN DEV              → wip
// DEV COMPLETE        → for-review
// IN QA               → for-review
// BLOCKED / ON HOLD   → on-hold
// DEFER               → on-hold
// QA VERIFIED         → done
// CLOSED              → done
// NOT REQUIRED        → done
// DUPLICATE           → done
function mapJiraStatus(status: any): string {
  const name = (status?.name ?? '').toLowerCase().trim()
  const cat  = status?.statusCategory?.key ?? ''

  if (name === 'open')                  return 'not-started'
  if (name === 'backlog')               return 'not-started'
  if (name === 'in dev')                return 'wip'
  if (name.startsWith('detailing'))     return 'wip'
  if (name === 'dev complete')          return 'for-review'
  if (name === 'in qa')                 return 'for-review'
  if (name.includes('blocked'))         return 'on-hold'
  if (name === 'defer')                 return 'on-hold'
  if (name === 'qa verified')           return 'done'
  if (name === 'closed')                return 'done'
  if (name === 'not required')          return 'done'
  if (name === 'duplicate')             return 'done'

  // Fallback to statusCategory
  if (cat === 'done')                   return 'done'
  if (cat === 'indeterminate')          return 'wip'
  return 'not-started'
}

// Atlassian migrated to POST /rest/api/3/search/jql (GET /rest/api/3/search is 410 Gone)
async function jiraSearch(jql: string): Promise<any[]> {
  const res = await fetch(`${JIRA_URL}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      'Authorization': jiraAuth(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jql,
      fields: ['summary', 'assignee', 'labels', 'components', 'issuelinks', 'status'],
      maxResults: 200,
    }),
  })
  if (!res.ok) throw new Error(`Jira search ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.issues || []
}

async function jiraGetIssue(key: string): Promise<any> {
  const res = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}?fields=labels,components,status`, {
    headers: { 'Authorization': jiraAuth(), 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira issue ${res.status}`)
  return res.json()
}

function mapAssignee(assignee: any): string | null {
  if (!assignee) return null
  const name = (assignee.displayName || '').toLowerCase()
  return MEMBERS.find(m => name.includes(m)) ?? null
}

async function getProductTag(issuelinks: any[]): Promise<string> {
  const link = (issuelinks || []).find((l: any) => l.outwardIssue || l.inwardIssue)
  if (!link) return ''
  const key = (link.outwardIssue || link.inwardIssue).key
  try {
    const d = await jiraGetIssue(key)
    const labels: string[] = d.fields.labels || []
    const comps: string[] = (d.fields.components || []).map((c: any) => c.name)
    return labels[0] || comps[0] || ''
  } catch { return '' }
}

// ── CAP Document workflow ─────────────────────────────────────────────────────
// Discovered via /rest/api/3/issue/{key}/transitions exploration on Document issues.
//
// Linear happy path (state name lowercase → next transition ID):
//   open (0) --391--> detailing in progress (1)
//   detailing in progress --221--> in dev (2)
//   in dev --241--> dev done (3)
//   dev done --251--> in qa (4)
//   in qa --261--> qa verified (5)
//
// Pause transitions (on-hold):
//   detailing in progress --411--> paused the work
//   in dev                --421--> paused the work
//   in qa                 --431--> paused the testing
//
// Reopen (any state → open): transition 11

const WORKFLOW_STATES = [
  'open', 'detailing in progress', 'in dev', 'dev done', 'in qa', 'qa verified', 'closed'
]
// FORWARD_IDS[i] moves from WORKFLOW_STATES[i] → WORKFLOW_STATES[i+1]
const FORWARD_IDS = ['391', '221', '241', '251', '261', '271']
const REOPEN_ID   = '11'
const PAUSE_IDS: Record<string, string> = {
  'detailing in progress': '411',
  'in dev':                '421',
  'in qa':                 '431',
}
// App status → target workflow state name
const APP_TARGET: Record<string, string | null> = {
  'not-started': 'open',
  'wip':         'in dev',
  'on-hold':     null,       // special: pause from current state
  'for-review':  'in qa',
  'commented':   'in dev',
  'done':        'closed',
}

async function applyTransition(key: string, id: string): Promise<void> {
  const res = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}/transitions`, {
    method: 'POST',
    headers: { 'Authorization': jiraAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id } }),
  })
  if (!res.ok) throw new Error(`Transition ${id} on ${key}: ${res.status} ${await res.text()}`)
}

async function getJiraStatusName(key: string): Promise<string> {
  const res = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}?fields=status`, {
    headers: { 'Authorization': jiraAuth(), 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Status fetch ${res.status}`)
  const data = await res.json()
  return (data.fields.status.name as string).toLowerCase()
}

// ── TRANSITION: push app status change back to Jira ──────────────────────────
async function handleTransition(rawKey: string, appStatus: string, cors: Record<string, string>): Promise<Response> {
  if (!(appStatus in APP_TARGET)) {
    return new Response(JSON.stringify({ ok: false, error: `Unknown app status: ${appStatus}` }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const key = /^\d+$/.test(rawKey.trim()) ? `CAP-${rawKey.trim()}` : rawKey.trim().toUpperCase()

  // ── GUARDRAIL 1: CAP project only ────────────────────────────────────────
  if (!key.startsWith('CAP-')) {
    return new Response(JSON.stringify({
      ok:    false,
      error: `Guardrail: only CAP project tickets can be transitioned (got "${key}") — other projects are never touched`,
    }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  try {
    // ── GUARDRAIL 2: issuetype + assignee check (single fetch) ───────────────
    const typeRes = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}?fields=issuetype,assignee`, {
      headers: { 'Authorization': jiraAuth(), 'Accept': 'application/json' },
    })
    if (!typeRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Jira issue fetch failed (HTTP ${typeRes.status}) — transition aborted` }), {
        status: typeRes.status, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const typeData = await typeRes.json()

    const issueTypeName: string = typeData.fields?.issuetype?.name ?? ''
    if (issueTypeName !== 'Document') {
      return new Response(JSON.stringify({
        ok:    false,
        error: `Guardrail: ${key} is a "${issueTypeName}" — only Document issues can be transitioned`,
      }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const assignee = typeData.fields?.assignee ?? null
    if (assignee !== null) {
      const displayName = (assignee.displayName || '').toLowerCase()
      const matched = MEMBERS.find(m => displayName.includes(m))
      if (!matched) {
        return new Response(JSON.stringify({
          ok:    false,
          error: `Guardrail: ${key} is assigned to "${assignee.displayName}" who is not in the tracked team — transition blocked to avoid affecting their workflow`,
        }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
    }
    // ── end guardrails ───────────────────────────────────────────────────────

    let currentState = await getJiraStatusName(key)
    const target = APP_TARGET[appStatus]

    // ── on-hold: pause from the current workflow state ──
    if (target === null) {
      if (!PAUSE_IDS[currentState]) {
        // States like open, dev done, qa verified, closed have no pause transition.
        // Rather than doing a risky multi-step write, skip and explain why.
        return new Response(JSON.stringify({
          ok:          true,
          transitioned: 'skipped',
          reason:      `"${currentState}" has no pause transition in the Document workflow — ticket left unchanged`,
        }), { headers: { ...cors, 'Content-Type': 'application/json' } })
      }
      await applyTransition(key, PAUSE_IDS[currentState])
      return new Response(JSON.stringify({ ok: true, transitioned: 'Paused' }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const targetIdx = WORKFLOW_STATES.indexOf(target)
    let currentIdx  = WORKFLOW_STATES.indexOf(currentState)

    // Unknown current state (paused/terminal) → reopen to Open
    if (currentIdx === -1) {
      await applyTransition(key, REOPEN_ID)
      currentIdx = 0
      currentState = 'open'
    }

    // Need to go backwards → reopen first
    if (currentIdx > targetIdx) {
      await applyTransition(key, REOPEN_ID)
      currentIdx = 0
    }

    // Walk forward one step at a time
    while (currentIdx < targetIdx) {
      await applyTransition(key, FORWARD_IDS[currentIdx])
      currentIdx++
    }

    return new Response(JSON.stringify({ ok: true, transitioned: WORKFLOW_STATES[targetIdx] }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
}

// ── ENRICH: single-ticket on-demand fetch ────────────────────────────────────
async function handleEnrich(rawKey: string, cors: Record<string, string>): Promise<Response> {
  if (!rawKey.trim()) {
    return new Response(JSON.stringify({ ok: false, error: 'No ticket key' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  // Normalise: "182100" → "CAP-182100"
  const key = /^\d+$/.test(rawKey.trim()) ? `CAP-${rawKey.trim()}` : rawKey.trim().toUpperCase()

  try {
    const res = await fetch(
      `${JIRA_URL}/rest/api/3/issue/${key}?fields=summary,status,assignee`,
      { headers: { 'Authorization': jiraAuth(), 'Accept': 'application/json' } },
    )
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: `Jira ${res.status}` }), {
        status: res.status, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const issue = await res.json()
    const f = issue.fields
    return new Response(JSON.stringify({
      ok:      true,
      key,
      summary: f.summary,
      status:  mapJiraStatus(f.status),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
}

// ── SYNC: bulk scheduled sync ────────────────────────────────────────────────
async function handleSync(supabase: any, cors: Record<string, string>): Promise<Response> {
  const issues = await jiraSearch(JIRA_JQL)

  // Fetch all existing ticket-keyed rows with their IDs
  const { data: existing } = await supabase
    .from('tasks')
    .select('id, ticket')
    .not('ticket', 'eq', '')

  const ticketToId = new Map<string, string>()
  ;(existing || []).forEach((r: any) => { if (r.ticket) ticketToId.set(r.ticket, r.id) })

  let added = 0, updated = 0
  const errors: string[] = []

  for (const issue of issues) {
    const f = issue.fields
    const mappedStatus = mapJiraStatus(f.status)

    if (ticketToId.has(issue.key)) {
      // UPDATE existing row: Jira is source of truth for task name and status
      const { error } = await supabase
        .from('tasks')
        .update({
          task:      f.summary,
          status:    mappedStatus,
          updatedat: new Date().toISOString(),
        })
        .eq('id', ticketToId.get(issue.key))
      if (!error) updated++
      else {
        const msg = `Update ${issue.key} failed: ${error.message}`
        console.error(msg)
        errors.push(msg)
      }
      continue
    }

    // INSERT new row
    let memberid = mapAssignee(f.assignee)
    let comments = ''
    if (!memberid) {
      const tag =
        (f.labels || [])[0] ||
        (f.components || [])?.[0]?.name ||
        await getProductTag(f.issuelinks || [])
      if (tag) comments = `Product: ${tag}`
      memberid = 'jira-bot'
    }

    const { error } = await supabase.from('tasks').insert({
      id: crypto.randomUUID(),
      memberid,
      task: f.summary,
      ticket: issue.key,
      status: mappedStatus,
      releasenotes: false,
      techticket: true,
      comments,
      createdat: new Date().toISOString(),
    })
    if (!error) { ticketToId.set(issue.key, crypto.randomUUID()); added++ }
    else {
      const msg = `Insert ${issue.key} failed: ${error.message}`
      console.error(msg)
      errors.push(msg)
    }
  }

  // ── Catch-up pass: any DB ticket not in the JQL window ──
  // The JQL is "created >= -15d", so older tickets never re-sync. Fetch them by key.
  const jiraKeys = new Set(issues.map((i: any) => i.key))
  const staleKeys = [...ticketToId.keys()].filter(k => !jiraKeys.has(k))

  if (staleKeys.length > 0) {
    // Jira limits "key in (...)" lists; chunk to 50 keys per request
    for (let i = 0; i < staleKeys.length; i += 50) {
      const chunk = staleKeys.slice(i, i + 50)
      const keyList = chunk.map(k => `"${k}"`).join(',')
      try {
        const staleIssues = await jiraSearch(`key in (${keyList}) AND issuetype = Document`)
        for (const issue of staleIssues) {
          const f = issue.fields
          const { error } = await supabase
            .from('tasks')
            .update({
              task:      f.summary,
              status:    mapJiraStatus(f.status),
              updatedat: new Date().toISOString(),
            })
            .eq('id', ticketToId.get(issue.key))
          if (!error) updated++
          else {
            const msg = `Catch-up update ${issue.key} failed: ${error.message}`
            console.error(msg)
            errors.push(msg)
          }
        }
      } catch (err: any) {
        const msg = `Catch-up chunk [${chunk[0]}…] failed: ${err.message}`
        console.error(msg)
        errors.push(msg)
      }
    }
  }

  return new Response(JSON.stringify({
    ok:      errors.length === 0,
    added,
    updated,
    ...(errors.length > 0 && { errors }),
  }), { headers: { ...cors, 'Content-Type': 'application/json' } })
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const body = req.method === 'POST'
      ? await req.json().catch(() => ({}))
      : {}
    const action: string = body.action ?? 'sync'

    if (action === 'enrich')     return handleEnrich(body.ticket ?? '', cors)
    if (action === 'transition') return handleTransition(body.ticket ?? '', body.appStatus ?? '', cors)
    return handleSync(supabase, cors)

  } catch (err: any) {
    console.error('Jira sync error:', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
