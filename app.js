/* =============================================
   TASK BOARD APP — JavaScript
   ============================================= */

// ── DATA ──────────────────────────────────────────────────────────────────

const MEMBERS = [
  { id: 'neeraj', name: 'Neeraj', initials: 'N', role: 'manager', accent: '#f59e0b', bg: 'rgba(245,158,11,0.18)' },
  { id: 'divya', name: 'Divya', initials: 'D', role: null, accent: '#9A275A', bg: 'rgba(154,39,90,0.18)' },
  { id: 'madhurima', name: 'Madhurima', initials: 'M', role: null, accent: '#a78bfa', bg: 'rgba(167,139,250,0.18)' },
  { id: 'george', name: 'George', initials: 'G', role: null, accent: '#34d399', bg: 'rgba(52,211,153,0.18)' },
  { id: 'naman', name: 'Naman', initials: 'N', role: null, accent: '#5865F2', bg: 'rgba(88,101,242,0.18)' },
];

const STATUSES = [
  { value: 'not-started', label: 'Not Started', cls: 'status-not-started' },
  { value: 'wip', label: 'WIP', cls: 'status-wip' },
  { value: 'on-hold', label: 'On Hold', cls: 'status-on-hold' },
  { value: 'for-review', label: 'For Review', cls: 'status-for-review' },
  { value: 'commented', label: 'Commented', cls: 'status-commented' },
  { value: 'done', label: 'Done', cls: 'status-done' },
];

const JIRA_BASE = 'https://capillarytech.atlassian.net/browse/';

// ── STATE ─────────────────────────────────────────────────────────────────

let currentView = 'home';
let activeFilter = {}; // memberId -> statusValue | null

// ── STORAGE (Supabase Cloud DB) ──────────────────────────────────────────

const SUPABASE_URL = 'https://afyptbwrsbsgfblyjvyp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmeXB0Yndyc2JzZ2ZibHlqdnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTE0NTYsImV4cCI6MjA5MjU4NzQ1Nn0.JseA1AMIhUCnl-QCpqA34J0XD7rQHVFV50fn87vLOdw';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function loadTasks(memberId) {
  console.log('Supabase: Loading tasks for', memberId);
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('memberId', memberId)
    .order('createdAt', { ascending: true });
  
  if (error) {
    console.error('Supabase Error (loadTasks):', error);
    return [];
  }
  console.log('Supabase: Loaded', data.length, 'tasks');
  return data;
}

async function saveTask(task) {
  console.log('Supabase: Saving task...', task);
  const { error } = await supabaseClient
    .from('tasks')
    .upsert(task);
  
  if (error) {
    console.error('Supabase Error (saveTask):', error);
  } else {
    console.log('Supabase: Save successful');
  }
}

async function deleteTaskFromDB(taskId) {
  console.log('Supabase: Deleting task...', taskId);
  const { error } = await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId);
  
  if (error) {
    console.error('Supabase Error (deleteTask):', error);
  } else {
    console.log('Supabase: Delete successful');
  }
}

async function allTasks() {
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*');
  
  if (error) {
    console.error('Error fetching all tasks:', error);
    return {};
  }

  const result = {};
  MEMBERS.forEach(m => {
    result[m.id] = data.filter(t => t.memberId === m.id);
  });
  return result;
}

// ── REALTIME SYNC ─────────────────────────────────────────────────────────

function setupRealtime() {
  supabaseClient
    .channel('schema-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async (payload) => {
      console.log('Realtime update received:', payload);
      
      // Update sidebar/overview count and refresh current view
      updateLastUpdated();
      
      if (currentView === 'home') {
        renderHomeView();
      } else {
        renderMemberView(currentView);
      }
    })
    .subscribe();
}

function getStatus(value) {
  return STATUSES.find(s => s.value === value) || STATUSES[0];
}

function generateId() {
  return crypto.randomUUID();
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────

function todayString() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────

function statusBadgeHtml(value) {
  const s = getStatus(value);
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

// ── HOME VIEW ─────────────────────────────────────────────────────────────

async function renderHomeView() {
  const tasks = await allTasks();

  const hour = new Date().getHours();
  let greeting = 'Good evening, team';
  if (hour < 12) greeting = 'Good morning, team';
  else if (hour < 17) greeting = 'Good afternoon, team';

  const titleEl = document.querySelector('#view-home .view-title');
  if (titleEl) titleEl.textContent = greeting;

  // Counts
  let totalTasks = 0;
  let doneTasks = 0;
  let wipTasks = 0;
  let blockedTasks = 0;
  let reviewTasks = 0;

  MEMBERS.forEach(m => {
    const mt = tasks[m.id] || [];
    totalTasks += mt.length;
    doneTasks += mt.filter(t => t.status === 'done').length;
    wipTasks += mt.filter(t => t.status === 'wip').length;
    blockedTasks += mt.filter(t => t.status === 'on-hold').length;
    reviewTasks += mt.filter(t => t.status === 'for-review' || t.status === 'commented').length;
  });

  const completionPct = totalTasks > 0 ? Math.round(doneTasks / totalTasks * 100) : 0;

  // Stats grid
  const statsGrid = document.getElementById('home-stats');
  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Total Tasks</div>
      <div class="stat-value">${totalTasks}</div>
      <div class="stat-sub">across all members</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Done</div>
      <div class="stat-value" style="color:#34d399">${doneTasks}</div>
      <div class="stat-sub">${completionPct}% completion</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">In Progress</div>
      <div class="stat-value" style="color:#60a5fa">${wipTasks}</div>
      <div class="stat-sub">actively working</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">For Review</div>
      <div class="stat-value" style="color:#a78bfa">${reviewTasks}</div>
      <div class="stat-sub">needs attention</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">On Hold</div>
      <div class="stat-value" style="color:#fbbf24">${blockedTasks}</div>
      <div class="stat-sub">blocked tasks</div>
    </div>
  `;

  // Team summary
  const summary = document.getElementById('home-team-summary');
  summary.innerHTML = `<div class="section-heading">Team Members</div>`;

  MEMBERS.forEach(m => {
    const mt = tasks[m.id] || [];
    const open = mt.filter(t => t.status !== 'done').length;

    // Count per status
    const statusCounts = {};
    mt.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

    const chips = STATUSES.filter(s => statusCounts[s.value])
      .map(s => `<span class="status-chip ${s.cls}" style="background: transparent; border: 1px solid rgba(255,255,255,0.1)">${statusCounts[s.value]} ${s.label}</span>`)
      .join('');

    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-left">
        <div class="member-avatar" style="background:${m.bg};color:${m.accent}">${m.initials}</div>
        <div class="member-name-block">
          <div class="member-name">${m.name}${m.role === 'manager' ? ' <span style="font-size:10px;color:var(--accent-neeraj);background:rgba(245,158,11,0.12);padding:1px 6px;border-radius:3px;font-family:var(--font-mono)">mgr</span>' : ''}</div>
          <div class="member-task-count">${mt.length} task${mt.length !== 1 ? 's' : ''} · ${open} open</div>
        </div>
      </div>
      <div class="team-card-right">${chips || '<span style="font-size:11px;color:var(--text-muted)">No tasks</span>'}</div>
    `;
    card.addEventListener('click', () => navigateTo(m.id));
    summary.appendChild(card);
  });
}

// ── MEMBER VIEW ───────────────────────────────────────────────────────────

async function renderMemberView(memberId) {
  const member = MEMBERS.find(m => m.id === memberId);
  let tasks = await loadTasks(memberId);

  if (member.role === 'manager') {
    const all = await allTasks();
    Object.keys(all).forEach(mId => {
      if (mId !== memberId) {
        tasks = tasks.concat(all[mId].filter(t => t.status === 'for-review'));
      }
    });
  }

  const filter = activeFilter[memberId] || null;
  const shown = filter ? tasks.filter(t => t.status === filter) : tasks;

  const activeTasks = shown.filter(t => t.status !== 'done');
  const doneTasks = shown.filter(t => t.status === 'done');

  const viewEl = document.getElementById(`view-${memberId}`);
  if (!viewEl || !member) return;

  // Status counts for filter bar
  const counts = {};
  STATUSES.forEach(s => { counts[s.value] = tasks.filter(t => t.status === s.value).length; });

  viewEl.innerHTML = `
    <div class="member-view-header">
      <div class="member-view-left">
        <div class="member-avatar-lg" style="background:${member.bg};color:${member.accent}">${member.initials}</div>
        <div>
          <div class="member-view-title" style="color:${member.accent}">${member.name}</div>
          <div class="member-view-meta">${tasks.length} task${tasks.length !== 1 ? 's' : ''} total · ${tasks.filter(t => t.status !== 'done').length} open</div>
        </div>
      </div>
    </div>

    <div class="filter-bar" id="filter-bar-${memberId}">
      <button class="filter-chip ${!filter ? 'active' : ''}" data-filter="all" data-member="${memberId}">
        All <span class="filter-chip-count">${tasks.length}</span>
      </button>
      ${STATUSES.map(s => counts[s.value] ? `
        <button class="filter-chip ${filter === s.value ? 'active' : ''}" data-filter="${s.value}" data-member="${memberId}">
          <span class="status-badge ${s.cls}" style="padding:0;background:transparent;font-size:11px">${s.label}</span>
          <span class="filter-chip-count">${counts[s.value]}</span>
        </button>` : '').join('')}
    </div>

    <div class="task-table-wrapper">
      <table class="task-table" id="task-table-${memberId}">
        <colgroup>
          <col class="col-task">
          <col class="col-ticket">
          <col class="col-status">
          <col class="col-check">
          <col class="col-check">
          <col class="col-comments">
          <col class="col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>Task</th>
            <th>Doc Ticket</th>
            <th>Status</th>
            <th title="is the release notes for this ticket added to the google doc and doc portal?">RN</th>
            <th title="is the tech ticket linked and doc link added to the tech ticket?">TT</th>
            <th>Comments</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${activeTasks.map(task => renderTaskRow(task, memberId)).join('')}
          <!-- Ghost trigger row for hover -->
          <tr class="add-row-trigger"><td colspan="7"></td></tr>
          <!-- Inline Add Row -->
          <tr class="task-row add-task-row" data-member-id="${memberId}">
            <td>
              <div class="task-cell-wrapper">
                <div class="row-member-badge" style="background:${member.bg}; color:${member.accent};" title="${member.name}">${member.initials}</div>
                <textarea class="inline-edit inline-task new-task-input" rows="1" placeholder="Add a new task..."></textarea>
              </div>
            </td>
            <td><input class="inline-edit inline-ticket new-ticket-input" placeholder="Ticket..." /></td>
            <td>
              <select class="inline-edit inline-status new-status-input">
                ${STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
              </select>
            </td>
            <td title="is the release notes for this ticket added to the google doc and doc portal?">
              <input type="checkbox" class="inline-checkbox new-rn-input" />
            </td>
            <td title="is the tech ticket linked and doc link added to the tech ticket?">
              <input type="checkbox" class="inline-checkbox new-tt-input" />
            </td>
            <td><textarea class="inline-edit inline-comments new-comments-input" rows="1" placeholder="Comments..."></textarea></td>
            <td>
              <button class="row-action-btn add-btn" title="Save new task">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5 10L12 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    ${doneTasks.length > 0 ? `
      <details class="completed-tasks-section">
        <summary>Completed Tasks (${doneTasks.length})</summary>
        <div class="task-table-wrapper">
          <table class="task-table">
            <colgroup>
              <col class="col-task">
              <col class="col-ticket">
              <col class="col-status">
              <col class="col-check">
              <col class="col-check">
              <col class="col-comments">
              <col class="col-actions">
            </colgroup>
            <tbody>
              ${doneTasks.map(task => renderTaskRow(task, memberId)).join('')}
            </tbody>
          </table>
        </div>
      </details>
    ` : ''}
  `;

  // Filter chips
  viewEl.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      const mid = chip.dataset.member;
      activeFilter[mid] = (f === 'all') ? null : f;
      renderMemberView(mid);
    });
  });

  // Attach event listeners for inline editing
  attachInlineEditListeners(viewEl, memberId);
}

function renderTaskRow(task, memberId) {
  const isDone = task.status === 'done';
  const owner = MEMBERS.find(m => m.id === task.memberId) || MEMBERS[0];
  return `
    <tr class="task-row${isDone ? ' done-row' : ''}" data-task-id="${task.id}">
      <td>
        <div class="task-cell-wrapper">
          <div class="row-member-badge" style="background:${owner.bg}; color:${owner.accent};" title="${owner.name}">${owner.initials}</div>
          <textarea class="inline-edit inline-task edit-task-field" rows="1">${escHtml(task.task)}</textarea>
        </div>
      </td>
      <td>
        <input class="inline-edit inline-ticket edit-ticket-field" value="${escHtml(task.ticket || '')}" placeholder="Ticket..." />
        ${task.ticket ? ticketHtml(task.ticket) : ''}
      </td>
      <td>
        <select class="inline-edit inline-status edit-status-field ${getStatus(task.status).cls}">
          ${STATUSES.map(s => `<option value="${s.value}" ${s.value === task.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </td>
      <td title="is the release notes for this ticket added to the google doc and doc portal?">
        <input type="checkbox" class="inline-checkbox edit-rn-field" ${task.releaseNotes ? 'checked' : ''} />
      </td>
      <td title="is the tech ticket linked and doc link added to the tech ticket?">
        <input type="checkbox" class="inline-checkbox edit-tt-field" ${task.techTicket ? 'checked' : ''} />
      </td>
      <td><textarea class="inline-edit inline-comments edit-comments-field" rows="1" placeholder="Comments...">${escHtml(task.comments || '')}</textarea></td>
      <td>
        <button class="row-action-btn delete-btn" title="Delete task">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3H12M4 3V2C4 1.44772 4.44772 1 5 1H9C9.55228 1 10 1.44772 10 2V3M5 6V10M9 6V10M3 3V12C3 12.5523 3.44772 13 4 13H10C10.5523 13 11 12.5523 11 12V3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </td>
    </tr>
  `;
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    overlay.classList.add('open');

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      overlay.classList.remove('open');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm, { once: true });
    cancelBtn.addEventListener('click', handleCancel, { once: true });
  });
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ticketHtml(ticket) {
  if (!ticket || !ticket.trim()) return '';
  const trimmed = ticket.trim();
  const display = /^\d+$/.test(trimmed) ? `CAP-${trimmed}` : trimmed;
  const url = JIRA_BASE + display;
  return `<a class="ticket-link-small" href="${url}" target="_blank" rel="noopener" title="Open in Jira">🔗</a>`;
}

// ── INLINE EDITING LOGIC ──────────────────────────────────────────────────

function attachInlineEditListeners(viewEl, memberId) {
  // Add new task on enter or add btn click
  const newRow = viewEl.querySelector('.add-task-row');
  if (newRow) {
    const saveNew = async () => {
      const taskVal = newRow.querySelector('.new-task-input').value.trim();
      if (!taskVal) return;
      const ticketVal = newRow.querySelector('.new-ticket-input').value.trim();
      const statusVal = newRow.querySelector('.new-status-input').value;
      const rnVal = newRow.querySelector('.new-rn-input').checked;
      const ttVal = newRow.querySelector('.new-tt-input').checked;
      const commentsVal = newRow.querySelector('.new-comments-input').value.trim();

      const newTask = {
        id: generateId(),
        memberId: memberId,
        task: taskVal,
        ticket: ticketVal,
        status: statusVal,
        releaseNotes: rnVal,
        techTicket: ttVal,
        comments: commentsVal,
        createdAt: new Date().toISOString()
      };
      await saveTask(newTask);
      updateLastUpdated();
      renderMemberView(memberId);
    };

    newRow.querySelector('.add-btn').addEventListener('click', saveNew);
    newRow.querySelectorAll('.inline-edit').forEach(el => {
      el.addEventListener('keydown', (e) => {
        // Only intercept Enter, not CMD/CTRL+C/V
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveNew();
        }
      });
    });
  }

  // Edit existing tasks
  viewEl.querySelectorAll('.task-row:not(.add-task-row)').forEach(row => {
    const taskId = row.dataset.taskId;

    const updateCurrentTask = async () => {
      const taskVal = row.querySelector('.edit-task-field').value.trim();
      const ticketVal = row.querySelector('.edit-ticket-field').value.trim();
      const statusVal = row.querySelector('.edit-status-field').value;
      const rnVal = row.querySelector('.edit-rn-field').checked;
      const ttVal = row.querySelector('.edit-tt-field').checked;
      const commentsVal = row.querySelector('.edit-comments-field').value.trim();

      if (!taskVal) return;

      const all = await allTasks();
      let existing = null;
      for (const mId in all) {
        existing = all[mId].find(t => t.id === taskId);
        if (existing) break;
      }
      if (!existing) return;

      const updatedTask = {
        ...existing,
        task: taskVal,
        ticket: ticketVal,
        status: statusVal,
        releaseNotes: rnVal,
        techTicket: ttVal,
        comments: commentsVal,
        updatedAt: new Date().toISOString()
      };

      await saveTask(updatedTask);
      updateLastUpdated();
      // Re-render if status changed to 'done' or filter is active
      if (existing.status !== statusVal) {
        renderMemberView(memberId);
      }
    };

    // Auto-resize textareas and handle blur/change
    row.querySelectorAll('.inline-edit, .inline-checkbox').forEach(el => {
      if (el.tagName === 'TEXTAREA') {
        el.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = (this.scrollHeight) + 'px';
        });
        el.addEventListener('blur', updateCurrentTask);
        el.addEventListener('keydown', (e) => {
          // Only intercept Enter, not CMD/CTRL+C/V
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            el.blur(); // will trigger update
          }
        });
      } else {
        el.addEventListener('change', updateCurrentTask);
      }
    });

    // Delete
    const deleteBtn = row.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm('Delete Task', 'Are you sure you want to delete this task? This action cannot be undone.');
        if (!confirmed) return;
        await deleteTaskFromDB(taskId);
        updateLastUpdated();
        renderMemberView(memberId);
      });
    }
  });
}

// ── NAVIGATION ────────────────────────────────────────────────────────────

async function navigateTo(viewId) {
  // Remove active from all nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const navBtn = document.getElementById(`nav-${viewId}`);
  if (navBtn) navBtn.classList.add('active');

  const viewEl = document.getElementById(`view-${viewId}`);
  if (viewEl) {
    viewEl.classList.add('active');
    if (viewId === 'home') {
      await renderHomeView();
    } else {
      await renderMemberView(viewId);
    }
  }

  currentView = viewId;

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('mobile-overlay').classList.remove('open');
}

// ── LAST UPDATED ──────────────────────────────────────────────────────────

function updateLastUpdated() {
  localStorage.setItem('last_updated', new Date().toISOString());
  const el = document.getElementById('last-updated-sidebar');
  if (!el) return;
  const raw = localStorage.getItem('last_updated');
  if (raw) {
    el.textContent = 'Updated ' + new Date(raw).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────

async function init() {
  // Initialize Realtime subscription
  setupRealtime();

  // Set date
  const dateEl = document.getElementById('header-date');
  if (dateEl) dateEl.textContent = todayString();

  // Nav buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // Mobile sidebar toggle
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const mobileOverlay = document.getElementById('mobile-overlay');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      mobileOverlay.classList.toggle('open');
    });
  }
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      mobileOverlay.classList.remove('open');
    });
  }

  // Seed demo data if empty
  if (!localStorage.getItem('demo_seeded_supabase_v1')) {
    const tasks = await allTasks();
    let total = 0;
    Object.keys(tasks).forEach(k => total += tasks[k].length);
    
    if (total === 0) {
      await seedDemoData();
      localStorage.setItem('demo_seeded_supabase_v1', '1');
    }
  }

  // Render initial view
  await renderHomeView();
  updateLastUpdated();
}

// ── DEMO DATA ─────────────────────────────────────────────────────────────

async function seedDemoData() {
  const demoTasks = {
    neeraj: [
      { id: generateId(), memberId: 'neeraj', task: 'Review Q1 documentation sprint', ticket: 'CAP-182100', status: 'wip', releaseNotes: false, techTicket: true, comments: 'In sync with product team', createdAt: new Date().toISOString() },
      { id: generateId(), memberId: 'neeraj', task: 'Approve pending PRs', ticket: '', status: 'for-review', releaseNotes: false, techTicket: false, comments: '', createdAt: new Date().toISOString() },
    ],
    divya: [
      { id: generateId(), memberId: 'divya', task: 'Write Loyalty API reference', ticket: 'CAP-182147', status: 'wip', releaseNotes: true, techTicket: true, comments: 'Draft ready, needs QA pass', createdAt: new Date().toISOString() },
      { id: generateId(), memberId: 'divya', task: 'Update promotion endpoints', ticket: 'CAP-182099', status: 'done', releaseNotes: true, techTicket: true, comments: 'Merged and live', createdAt: new Date().toISOString() },
    ],
    madhurima: [
      { id: generateId(), memberId: 'madhurima', task: 'Document Behavioral Events schema', ticket: 'CAP-181920', status: 'not-started', releaseNotes: false, techTicket: false, comments: '', createdAt: new Date().toISOString() },
      { id: generateId(), memberId: 'madhurima', task: 'Coupon issuance flow diagram', ticket: '', status: 'wip', releaseNotes: false, techTicket: false, comments: 'Lucidchart WIP', createdAt: new Date().toISOString() },
    ],
    george: [
      { id: generateId(), memberId: 'george', task: 'Tier upgrade rules documentation', ticket: 'CAP-182055', status: 'for-review', releaseNotes: true, techTicket: true, comments: 'Shared in Slack for review', createdAt: new Date().toISOString() },
    ],
    naman: [
      { id: generateId(), memberId: 'naman', task: 'Vulcan statistics dashboard docs', ticket: 'CAP-182200', status: 'wip', releaseNotes: false, techTicket: true, comments: 'Frontend done, writing API section', createdAt: new Date().toISOString() },
      { id: generateId(), memberId: 'naman', task: 'Update changelog', ticket: '', status: 'not-started', releaseNotes: false, techTicket: false, comments: '', createdAt: new Date().toISOString() },
    ],
  };

  const tasksArray = await allTasks();
  let isEmpty = true;
  for (const k in tasksArray) {
    if (tasksArray[k].length > 0) isEmpty = false;
  }

  if (isEmpty) {
    for (const m of MEMBERS) {
      if (demoTasks[m.id]) {
        for (const t of demoTasks[m.id]) {
          await saveTask(t);
        }
      }
    }
  }

  await renderHomeView();
  updateLastUpdated();
}

// ── KICK OFF ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
