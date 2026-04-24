# Task Board — CLAUDE.md

## Project Overview
Vanilla static web app (HTML + CSS + JS). No build system, no package.json.
Backend: Supabase Cloud (Postgres + Realtime).
Dev server: `python3 -m http.server 8080` (see `.claude/launch.json`).

---

## Supabase Schema

**Table: `tasks`**

| App field (camelCase) | DB column (lowercase) | Type |
|---|---|---|
| `id` | `id` | `uuid` (NOT NULL, primary key) |
| `memberId` | `memberid` | `text` |
| `task` | `task` | `text` (NOT NULL) |
| `ticket` | `ticket` | `text` |
| `status` | `status` | `text` |
| `releaseNotes` | `releasenotes` | `boolean` |
| `techTicket` | `techticket` | `boolean` |
| `comments` | `comments` | `text` |
| `createdAt` | `createdat` | `timestamp` |
| `updatedAt` | `updatedat` | `timestamp` (NOT NULL, has DB default) |

**Critical rules:**
- All columns are **all-lowercase** — no camelCase, no snake_case.
- `updatedat` is NOT NULL with a DB-side default. **Never send `updatedat: null`** — omit the field entirely and the DB sets it automatically.
- `id` must be a valid UUID (`crypto.randomUUID()`).
- Mapping is handled by `taskToDb()` and `taskFromDb()` in `app.js`.

---

## Data Flow

```
App object (camelCase)
  → taskToDb()       → DB row (lowercase)   → supabaseClient.upsert()
  ← taskFromDb()     ← DB row (lowercase)   ← supabaseClient.select()
```

All Supabase queries must use lowercase column names:
- `.eq('memberid', memberId)` ✓  — NOT `.eq('memberId', ...)`
- `.order('createdat', ...)` ✓   — NOT `.order('createdAt', ...)`

---

## Architecture

```
index.html          — entry point, loads Supabase SDK from CDN
app.js              — all logic: data, rendering, event handling
style.css           — all styles (CSS vars in :root)
.claude/
  launch.json       — dev server config for preview_start
```

### Key functions in app.js
| Function | Purpose |
|---|---|
| `taskToDb(t)` | Converts app object → DB row (omits `updatedat` if falsy) |
| `taskFromDb(row)` | Converts DB row → app object |
| `loadTasks(memberId)` | Fetches tasks filtered by `memberid` |
| `saveTask(task)` | Upserts via `taskToDb()` |
| `deleteTaskFromDB(taskId)` | Deletes by `id` |
| `allTasks()` | Fetches all tasks, groups by memberId |
| `renderMemberView(memberId)` | Full re-render of a member's view (re-attaches all listeners) |
| `attachInlineEditListeners(viewEl, memberId)` | Wires up save/delete on rows |
| `renderTaskRow(task, memberId)` | Returns HTML string for a task row |
| `showConfirm(title, msg)` | Promise-based custom confirm modal |

---

## Members
```js
['neeraj' (manager), 'divya', 'madhurima', 'george', 'naman']
```
Manager (Neeraj) also sees all `for-review` tasks from other members.

---

## Add-Task Hover Logic

The add-task row lives inside `<tbody>` (hidden by default, class `add-task-row`).
A `div.add-task-zone-trigger` sits below the table and is the sole hover target.

**Flicker fix:** When the trigger is hovered and `add-task-row` becomes visible, the table
grows and pushes the trigger down — this fires `mouseleave` on the trigger. The fix:
`scheduleHide()` uses a 150ms timer that checks `trigger.matches(':hover')` and
`addRow.matches(':hover')` before hiding. CSS `:hover` reflects real cursor position even
when `mouseenter` didn't fire (element appeared under stationary cursor).

**Only the trigger zone should show the add-row** — do NOT add hover listeners on existing rows.

---

## CSS Patterns

- Delete button: `opacity: 0.25` always, `opacity: 1` on `.task-row:hover`, red on `.delete-btn:hover`.
- Completed tasks collapsible: native `<details>` with custom CSS chevron via `::before` (triangle, rotates 90° when `[open]`). Native marker hidden via `::-webkit-details-marker` + `list-style: none`.
- Status badges use `.status-{value}` classes.
- `--font-display`: Poppins, `--font-mono`: IBM Plex Mono.

---

## Realtime
Supabase Realtime subscription on `tasks` table re-renders the current view on any change.
No column-level filtering needed — just triggers `renderMemberView(currentView)`.
