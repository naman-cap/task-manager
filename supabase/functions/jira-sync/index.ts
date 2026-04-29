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
      fields: ['summary', 'assignee', 'labels', 'components', 'issuelinks'],
      maxResults: 50,
    }),
  })
  if (!res.ok) throw new Error(`Jira search ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.issues || []
}

async function jiraGetIssue(key: string): Promise<any> {
  const res = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}?fields=labels,components`, {
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const issues = await jiraSearch(JIRA_JQL)

    const { data: existing } = await supabase
      .from('tasks')
      .select('ticket')
      .not('ticket', 'eq', '')
    const seen = new Set((existing || []).map((r: any) => r.ticket).filter(Boolean))

    let added = 0
    for (const issue of issues) {
      if (seen.has(issue.key)) continue
      const f = issue.fields
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
        status: 'not-started',
        releasenotes: false,
        techticket: true,
        comments,
        createdat: new Date().toISOString(),
      })
      if (!error) { seen.add(issue.key); added++ }
      else console.error('Insert error:', error)
    }

    return new Response(JSON.stringify({ ok: true, added }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('Jira sync error:', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
