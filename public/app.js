const state = { me: null, currentWeekStart: null, weekData: null, swapContext: null, pendingComplete: null, lastActiveNav: 'dashboard' };

const AVATAR_COLORS = ['#c1652f', '#6f8f6a', '#7a6bb5', '#c14b4b', '#3f7a9e'];
const CHART_COLORS = ['#c1652f', '#6f8f6a', '#7a6bb5', '#c14b4b', '#3f7a9e', '#e0a458', '#4a8f8b', '#a45c8c'];

function colorFor(name) {
  let sum = 0;
  for (const c of name) sum += c.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}
function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function avatarHtml(user, sizeClass) {
  if (user.avatar) {
    return `<span class="avatar ${sizeClass}"><img src="${user.avatar}" alt="${user.name}"></span>`;
  }
  return `<span class="avatar ${sizeClass}" style="background:${colorFor(user.name)}">${initials(user.name)}</span>`;
}
// Reemplaza un <span id="..."> existente por el avatar actualizado, conservando el id.
function setAvatarEl(id, user, sizeClass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.outerHTML = avatarHtml(user, sizeClass).replace('<span', `<span id="${id}"`);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// ---------------- Login / tabs ----------------

function showAuthPanel(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.hidden = true; });
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');
  const panel = document.querySelector(`.tab-panel[data-panel="${name}"]`);
  panel.classList.add('active');
  panel.hidden = false;
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showAuthPanel(btn.dataset.tab));
});

document.getElementById('btn-forgot').addEventListener('click', () => showAuthPanel('forgot'));
document.getElementById('btn-forgot-cancel').addEventListener('click', () => showAuthPanel('login'));

document.getElementById('form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    await boot();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('form-forgot').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('forgot-error');
  const okEl = document.getElementById('forgot-success');
  errEl.textContent = ''; okEl.textContent = '';
  try {
    const { hasEmail } = await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ username: document.getElementById('forgot-username').value })
    });
    okEl.textContent = hasEmail
      ? 'Si el usuario existe, le llegó un correo con el link para elegir una contraseña nueva.'
      : 'Ese usuario todavía no tiene un email de recuperación cargado en su perfil. Pedile que lo cargue primero.';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('form-register').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  const body = {
    householdName: document.getElementById('reg-household').value,
    members: [
      { name: document.getElementById('reg-name1').value, username: document.getElementById('reg-user1').value, password: document.getElementById('reg-pass1').value },
      { name: document.getElementById('reg-name2').value, username: document.getElementById('reg-user2').value, password: document.getElementById('reg-pass2').value }
    ]
  };
  try {
    await api('/auth/register-household', { method: 'POST', body: JSON.stringify(body) });
    await boot();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('btn-logout-mobile').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

// ---------------- Nav / páginas ----------------

function showPage(pageId, navBtnPage) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (navBtnPage) {
    const btn = document.querySelector(`.nav-btn[data-page="${navBtnPage}"]`);
    if (btn) btn.classList.add('active');
    state.lastActiveNav = navBtnPage;
  }
  if (pageId === 'tasks') loadTasks();
  if (pageId === 'history') loadHistoryWeeks();
  if (pageId === 'stats') loadStats();
  if (pageId === 'profile' && state.me) {
    setAvatarEl('profile-page-avatar', state.me.user, 'large');
    document.getElementById('recovery-email').value = state.me.user.recoveryEmail || '';
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-error').textContent = '';
    document.getElementById('pwd-success').textContent = '';
    document.getElementById('email-success').textContent = '';
    document.getElementById('avatar-error').textContent = '';
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showPage(btn.dataset.page, btn.dataset.page));
});

// ---------------- Boot ----------------

async function registerOneSignal(userId) {
  if (typeof window.OneSignalDeferred === 'undefined') return;
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      OneSignal.User.setExternalId(userId);
      const subId = await OneSignal.User.PushSubscription.id;
      if (subId) {
        await api('/push/register', { method: 'POST', body: JSON.stringify({ oneSignalUserId: subId }) });
      }
    } catch {}
  });
}

async function boot() {
  try {
    const me = await api('/me');
    state.me = me;
    document.getElementById('view-login').hidden = true;
    document.getElementById('view-app').hidden = false;
    document.getElementById('household-name').textContent = me.household.name;
    document.getElementById('current-user-name').textContent = me.user.name;
    setAvatarEl('profile-avatar', me.user, 'small');
    await loadNotifications();
    await loadDashboard();
    registerOneSignal(me.user.id);
  } catch (err) {
    document.getElementById('view-login').hidden = false;
    document.getElementById('view-app').hidden = true;
  }
}

// ---------------- Notifications ----------------

document.getElementById('btn-notifications').addEventListener('click', async () => {
  const panel = document.getElementById('notifications-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) await loadNotifications();
});

async function loadNotifications() {
  const { notifications } = await api('/notifications');
  const unread = notifications.filter(n => !n.read);
  document.getElementById('notif-dot').hidden = unread.length === 0;

  const panel = document.getElementById('notifications-panel');
  if (notifications.length === 0) {
    panel.innerHTML = '<div class="empty-state">Todavía no hay notificaciones.</div>';
    return;
  }

  panel.innerHTML = notifications.map(n => {
    const showSwapActions = n.type === 'swap_request' && !n.read;
    return `
      <div class="notif-item">
        <div class="notif-top">
          <span>${n.read ? '' : '🔵 '}${n.message}</span>
          ${n.read ? '' : `<button data-id="${n.id}" class="mark-read">Marcar leída</button>`}
        </div>
        ${showSwapActions ? `
          <div class="notif-actions" data-swap-id="${n.swapRequestId}">
            <input type="text" class="swap-response-msg" placeholder="Mensaje de respuesta (opcional)">
            <button class="btn primary small swap-accept">Aceptar</button>
            <button class="btn ghost small swap-deny">Rechazar</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  panel.querySelectorAll('.mark-read').forEach(b => {
    b.addEventListener('click', async () => {
      await api(`/notifications/${b.dataset.id}/read`, { method: 'POST' });
      await loadNotifications();
    });
  });

  panel.querySelectorAll('.notif-actions').forEach(box => {
    const swapId = box.dataset.swapId;
    const input = box.querySelector('.swap-response-msg');
    box.querySelector('.swap-accept').addEventListener('click', () => respondSwap(swapId, 'accept', input.value));
    box.querySelector('.swap-deny').addEventListener('click', () => respondSwap(swapId, 'deny', input.value));
  });
}

async function respondSwap(swapId, decision, responseMessage) {
  try {
    await api(`/swaps/${swapId}/respond`, { method: 'POST', body: JSON.stringify({ decision, responseMessage }) });
    await loadNotifications();
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- Hover tooltip helper ----------------

function attachHoverTooltip(anchorEl, containerEl, tooltipClass, buildHtml) {
  let tooltip = null;
  const show = () => {
    if (tooltip) return;
    tooltip = document.createElement('div');
    tooltip.className = tooltipClass;
    tooltip.innerHTML = buildHtml();
    containerEl.appendChild(tooltip);
  };
  const hide = () => { if (tooltip) { tooltip.remove(); tooltip = null; } };
  anchorEl.addEventListener('mouseenter', show);
  anchorEl.addEventListener('mouseleave', hide);
  anchorEl.addEventListener('click', e => { e.stopPropagation(); tooltip ? hide() : show(); });
}

// ---------------- Dashboard ----------------

function thisWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

async function loadDashboard() {
  const weekStart = thisWeekStart();
  const { byUser, weekStart: actualWeek, currentUserId } = await api('/assignments?weekStart=' + weekStart);
  state.currentWeekStart = actualWeek;
  state.weekData = { byUser, currentUserId };
  document.getElementById('week-label').textContent = new Date(actualWeek + 'T00:00:00')
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

  const container = document.getElementById('columns');
  container.innerHTML = '';

  const entries = Object.values(byUser);
  const me = entries.find(e => e.user.id === currentUserId);
  const others = entries.filter(e => e.user.id !== currentUserId);

  if (me) container.appendChild(renderMyColumn(me));
  others.forEach(o => container.appendChild(renderPartnerColumn(o)));
}

function renderMyColumn({ user, tasks }) {
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const col = document.createElement('div');
  col.className = 'person-column me';
  col.innerHTML = `
    <div class="person-header">
      <h3>${avatarHtml(user, '')}${user.name}</h3>
    </div>
    <div class="progress-pct">${pct}% completado</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${colorFor(user.name)}"></div></div>
    <div class="progress-count">${done} de ${tasks.length} tareas</div>
    <div class="task-list"></div>
  `;
  const list = document.createElement('div');
  list.className = 'task-list';
  if (tasks.length === 0) {
    list.innerHTML = '<div class="empty-state">No tenés tareas asignadas esta semana. 🎉</div>';
  }
  tasks.forEach(t => {
    const row = document.createElement('div');
    row.className = 'task-row' + (t.status === 'done' ? ' done' : '');
    row.innerHTML = `
      <div class="check">${t.status === 'done' ? '✓' : ''}</div>
      <div class="task-info">
        <span class="task-name">${t.taskName}</span>
        ${t.carriedOver ? '<span class="carried-badge" title="No se completó a tiempo la semana pasada">Atrasada</span>' : ''}
        ${t.status === 'done' ? `<span class="task-completed-at">${formatDateTime(t.completedAt)}</span>` : ''}
        <div class="task-freq">${t.frequencyLabel}</div>
      </div>
      ${t.status !== 'done' ? '<button class="swap-btn" title="Proponer intercambio">🔁</button>' : ''}
    `;

    if (t.taskDescription) {
      const nameEl = row.querySelector('.task-name');
      attachHoverTooltip(nameEl, row.querySelector('.task-info'), 'desc-tooltip', () => t.taskDescription);
    }

    if (t.status !== 'done') {
      row.addEventListener('click', () => openConfirmModal(t));
    }
    const swapBtn = row.querySelector('.swap-btn');
    if (swapBtn) swapBtn.addEventListener('click', e => { e.stopPropagation(); openSwapModal(t); });
    list.appendChild(row);
  });
  col.querySelector('.task-list').replaceWith(list);
  return col;
}

function renderPartnerColumn({ user, tasks }) {
  const done = tasks.filter(t => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const col = document.createElement('div');
  col.className = 'person-column partner';
  col.innerHTML = `
    <div class="person-header">
      <h3>${avatarHtml(user, '')}${user.name}</h3>
    </div>
    <div class="progress-pct">${pct}% completado</div>
    <div class="progress-bar partner-progress"><div class="progress-fill" style="width:${pct}%; background:${colorFor(user.name)}"></div></div>
    <button class="partner-toggle-btn">Ver tareas de ${user.name}</button>
    <div class="partner-task-list" hidden></div>
  `;

  const bar = col.querySelector('.partner-progress');
  attachHoverTooltip(bar, bar, 'partner-tooltip', () => {
    const completed = tasks.filter(t => t.status === 'done');
    return `
      <h4>Tareas que ${user.name} ya completó</h4>
      ${completed.length === 0
        ? '<div class="tt-empty">Todavía no completó ninguna esta semana.</div>'
        : `<ul>${completed.map(t => `<li><strong>${t.taskName}</strong><br>${formatDateTime(t.completedAt)}</li>`).join('')}</ul>`}
    `;
  });

  const toggleBtn = col.querySelector('.partner-toggle-btn');
  const listBox = col.querySelector('.partner-task-list');
  let expanded = false;
  toggleBtn.addEventListener('click', () => {
    expanded = !expanded;
    listBox.hidden = !expanded;
    toggleBtn.textContent = expanded ? `Ocultar tareas de ${user.name}` : `Ver tareas de ${user.name}`;
    if (expanded && listBox.innerHTML === '') {
      listBox.innerHTML = tasks.length === 0
        ? '<div class="empty-state">No tiene tareas asignadas esta semana.</div>'
        : tasks.map(t => `
          <div class="partner-task-row ${t.status === 'done' ? 'done' : ''}">
            <span class="ptr-name">${t.taskName} <span class="muted">(${t.frequencyLabel})</span>${t.carriedOver ? '<span class="carried-badge">Atrasada</span>' : ''}</span>
            <span class="ptr-status">${t.status === 'done' ? '✓ ' + formatDateTime(t.completedAt) : 'Pendiente'}</span>
          </div>
        `).join('');
    }
  });

  return col;
}

// ---------------- Confirmar completar tarea ----------------

const confirmModal = document.getElementById('confirm-modal');

function openConfirmModal(task) {
  state.pendingComplete = task;
  document.getElementById('confirm-modal-text').textContent = `¿Marcar "${task.taskName}" como realizada?`;
  confirmModal.hidden = false;
}
document.getElementById('confirm-no').addEventListener('click', () => { confirmModal.hidden = true; state.pendingComplete = null; });
document.getElementById('confirm-yes').addEventListener('click', async () => {
  const task = state.pendingComplete;
  confirmModal.hidden = true;
  if (!task) return;
  try {
    await api(`/assignments/${task.id}/complete`, { method: 'POST' });
    await loadDashboard();
    await loadNotifications();
    checkCelebration();
  } catch (err) {
    alert(err.message);
  }
});

function checkCelebration() {
  const { byUser, currentUserId } = state.weekData;
  const mine = byUser[currentUserId];
  if (!mine || mine.tasks.length === 0) return;
  const allDone = mine.tasks.every(t => t.status === 'done');
  if (allDone) showCelebration();
}

function showCelebration() {
  document.getElementById('celebration-modal').hidden = false;
  launchConfetti();
}
document.getElementById('celebration-close').addEventListener('click', () => {
  document.getElementById('celebration-modal').hidden = true;
});

function launchConfetti() {
  const layer = document.getElementById('confetti-layer');
  const colors = ['#c1652f', '#6f8f6a', '#7a6bb5', '#c14b4b', '#3f7a9e', '#e0a458'];
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 6;
    piece.style.width = size + 'px';
    piece.style.height = (size * 0.4) + 'px';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
    piece.style.animationDelay = (Math.random() * 0.6) + 's';
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), 5500);
  }
}

// ---------------- Swap modal ----------------

const swapModal = document.getElementById('swap-modal');

function openSwapModal(myTaskPreselect) {
  const { byUser, currentUserId } = state.weekData;
  const mine = byUser[currentUserId];
  const partnerEntry = Object.values(byUser).find(e => e.user.id !== currentUserId);
  const myPending = mine ? mine.tasks.filter(t => t.status !== 'done') : [];
  const partnerPending = partnerEntry ? partnerEntry.tasks.filter(t => t.status !== 'done') : [];

  if (myPending.length === 0) {
    alert('No te quedan tareas pendientes para ofrecer.');
    return;
  }
  if (!partnerEntry || partnerPending.length === 0) {
    alert('Tu pareja no tiene tareas pendientes esta semana para intercambiar.');
    return;
  }

  state.swapContext = { partnerEntry };
  document.getElementById('swap-partner-name').textContent = partnerEntry.user.name;

  const fromSelect = document.getElementById('swap-from-select');
  fromSelect.innerHTML = myPending.map(t => `<option value="${t.id}">${t.taskName} (${t.frequencyLabel})</option>`).join('');
  if (myTaskPreselect) fromSelect.value = myTaskPreselect.id;

  const targetSelect = document.getElementById('swap-target-select');
  targetSelect.innerHTML = partnerPending.map(t => `<option value="${t.id}">${t.taskName} (${t.frequencyLabel})</option>`).join('');

  document.getElementById('swap-message').value = '';
  document.getElementById('swap-error').textContent = '';
  swapModal.hidden = false;
}

document.getElementById('swap-cancel').addEventListener('click', () => { swapModal.hidden = true; });

document.getElementById('swap-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('swap-error');
  errEl.textContent = '';
  const fromAssignmentId = document.getElementById('swap-from-select').value;
  const toAssignmentId = document.getElementById('swap-target-select').value;
  const message = document.getElementById('swap-message').value;
  try {
    await api('/swaps', { method: 'POST', body: JSON.stringify({ fromAssignmentId, toAssignmentId, message }) });
    swapModal.hidden = true;
    await loadDashboard();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------------- Tasks admin ----------------

const freqSelect = document.getElementById('new-task-freq');
const customDaysInput = document.getElementById('new-task-custom-days');

freqSelect.addEventListener('change', () => {
  customDaysInput.hidden = freqSelect.value !== 'Personalizado';
});

document.getElementById('form-new-task').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('new-task-name').value;
  const frequencyLabel = freqSelect.value;
  const customDays = customDaysInput.value;
  const description = document.getElementById('new-task-description').value;
  await api('/tasks', { method: 'POST', body: JSON.stringify({ name, frequencyLabel, customDays, description }) });
  document.getElementById('new-task-name').value = '';
  document.getElementById('new-task-description').value = '';
  await loadTasks();
});

let tasksCache = [];

async function loadTasks() {
  const { tasks, frequencies } = await api('/tasks');
  tasksCache = tasks;

  [freqSelect, document.getElementById('edit-task-freq')].forEach(sel => {
    if (sel.children.length === 0) {
      sel.innerHTML = frequencies.map(f => `<option value="${f}">${f}</option>`).join('')
        + '<option value="Personalizado">Personalizado (elegir días)</option>';
    }
  });

  const tbody = document.getElementById('tasks-tbody');
  tbody.innerHTML = tasks.map(t => `
    <tr>
      <td>
        ${t.name}
        ${t.description ? `<div class="task-desc-preview">${t.description}</div>` : ''}
      </td>
      <td>${t.frequencyLabel} <span class="muted">(${t.frequencyDays} días)</span></td>
      <td><span class="badge ${t.active ? '' : 'inactive'}">${t.active ? 'Activa' : 'Inactiva'}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn ghost small edit-task" data-id="${t.id}">Editar</button>
          <button class="btn ghost small toggle-task" data-id="${t.id}">${t.active ? 'Desactivar' : 'Activar'}</button>
          <button class="btn danger small delete-task" data-id="${t.id}" data-name="${t.name}">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.toggle-task').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/tasks/${btn.dataset.id}/toggle-active`, { method: 'POST' });
      await loadTasks();
    });
  });

  tbody.querySelectorAll('.edit-task').forEach(btn => {
    btn.addEventListener('click', () => openEditTaskModal(btn.dataset.id));
  });

  tbody.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', () => openDeleteTaskModal(btn.dataset.id, btn.dataset.name));
  });
}

// -------- editar tarea --------

const editTaskModal = document.getElementById('edit-task-modal');
const editFreqSelect = document.getElementById('edit-task-freq');
const editCustomDays = document.getElementById('edit-task-custom-days');
let editingTaskId = null;

editFreqSelect.addEventListener('change', () => {
  editCustomDays.hidden = editFreqSelect.value !== 'Personalizado';
});

function openEditTaskModal(taskId) {
  const task = tasksCache.find(t => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.getElementById('edit-task-name').value = task.name;
  document.getElementById('edit-task-description').value = task.description || '';
  editFreqSelect.value = task.frequencyLabel;
  editCustomDays.hidden = task.frequencyLabel !== 'Personalizado';
  editCustomDays.value = task.frequencyLabel === 'Personalizado' ? task.frequencyDays : '';
  document.getElementById('edit-task-error').textContent = '';

  const userSelect = document.getElementById('edit-task-last-user');
  if (state.me) {
    userSelect.innerHTML = state.me.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  }
  document.getElementById('edit-task-last-date').value = '';
  document.getElementById('edit-task-history-error').textContent = '';
  document.getElementById('edit-task-history-success').textContent = '';

  editTaskModal.hidden = false;
}
document.getElementById('edit-task-cancel').addEventListener('click', () => { editTaskModal.hidden = true; });
document.getElementById('edit-task-save').addEventListener('click', async () => {
  const errEl = document.getElementById('edit-task-error');
  errEl.textContent = '';
  try {
    await api(`/tasks/${editingTaskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('edit-task-name').value,
        description: document.getElementById('edit-task-description').value,
        frequencyLabel: editFreqSelect.value,
        customDays: editCustomDays.value
      })
    });
    editTaskModal.hidden = true;
    await loadTasks();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('edit-task-save-history').addEventListener('click', async () => {
  const errEl = document.getElementById('edit-task-history-error');
  const okEl = document.getElementById('edit-task-history-success');
  errEl.textContent = ''; okEl.textContent = '';
  const date = document.getElementById('edit-task-last-date').value;
  const userId = document.getElementById('edit-task-last-user').value;
  if (!date) { errEl.textContent = 'Elegí una fecha.'; return; }
  try {
    await api(`/tasks/${editingTaskId}/set-last-completed`, { method: 'POST', body: JSON.stringify({ date, userId }) });
    okEl.textContent = 'Registrado. Va a afectar el próximo reparto y va a aparecer en el Histórico.';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// -------- eliminar tarea --------

const deleteTaskModal = document.getElementById('delete-task-modal');
let deletingTaskId = null;

function openDeleteTaskModal(taskId, name) {
  deletingTaskId = taskId;
  document.getElementById('delete-task-text').textContent = `¿Eliminar "${name}" definitivamente? Lo que ya se completó queda igual en el histórico.`;
  deleteTaskModal.hidden = false;
}
document.getElementById('delete-task-cancel').addEventListener('click', () => { deleteTaskModal.hidden = true; });
document.getElementById('delete-task-confirm').addEventListener('click', async () => {
  await api(`/tasks/${deletingTaskId}`, { method: 'DELETE' });
  deleteTaskModal.hidden = true;
  await loadTasks();
});

// ---------------- Perfil (página) ----------------

document.getElementById('btn-profile').addEventListener('click', () => {
  showPage('profile', null);
});
document.getElementById('profile-back').addEventListener('click', () => showPage(state.lastActiveNav, state.lastActiveNav));

document.getElementById('avatar-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const errEl = document.getElementById('avatar-error');
  errEl.textContent = '';
  const statusEl = document.getElementById('avatar-upload-status');
  statusEl.hidden = false;
  statusEl.textContent = 'Subiendo...';
  try {
    const avatarPreview = document.getElementById('profile-page-avatar');
    const reader = new FileReader();
    reader.onload = () => { avatarPreview.innerHTML = `<img src="${reader.result}" alt="preview">`; };
    reader.readAsDataURL(file);
    const dataUrl = await resizeImageToDataUrl(file, 200);
    const { user } = await api('/me/avatar', { method: 'PUT', body: JSON.stringify({ avatarDataUrl: dataUrl }) });
    state.me.user = user;
    setAvatarEl('profile-page-avatar', user, 'large');
    setAvatarEl('profile-avatar', user, 'small');
    statusEl.hidden = true;
    await loadDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    statusEl.hidden = true;
  }
});

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) { height = height * (maxSize / width); width = maxSize; }
        else { width = width * (maxSize / height); height = maxSize; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('pwd-save').addEventListener('click', async () => {
  const errEl = document.getElementById('pwd-error');
  const okEl = document.getElementById('pwd-success');
  errEl.textContent = ''; okEl.textContent = '';
  try {
    await api('/me/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: document.getElementById('pwd-current').value,
        newPassword: document.getElementById('pwd-new').value
      })
    });
    okEl.textContent = 'Contraseña actualizada.';
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('email-save').addEventListener('click', async () => {
  const okEl = document.getElementById('email-success');
  const { user } = await api('/me/recovery-email', { method: 'PUT', body: JSON.stringify({ email: document.getElementById('recovery-email').value }) });
  state.me.user = user;
  okEl.textContent = 'Email guardado.';
});

// ---------------- History ----------------

async function loadHistoryWeeks() {
  const { weeks } = await api('/weeks');
  const select = document.getElementById('history-week-select');
  if (weeks.length === 0) {
    select.innerHTML = '';
    document.getElementById('history-content').innerHTML = '<div class="empty-state">Todavía no hay semanas generadas.</div>';
    return;
  }
  select.innerHTML = weeks.map(w => `<option value="${w}">Semana del ${new Date(w + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</option>`).join('');
  select.onchange = () => loadHistoryWeek(select.value);
  await loadHistoryWeek(weeks[0]);
}

async function loadHistoryWeek(weekStart) {
  const { byUser, swaps } = await api('/history?weekStart=' + weekStart);
  const content = document.getElementById('history-content');

  const statusLabel = t => {
    if (t.status === 'done') return t.manualEntry ? 'Hecha (registro manual)' : 'Hecha';
    if (t.status === 'carried') return 'No completada (se trasladó)';
    return 'Pendiente';
  };

  const columnsHtml = Object.values(byUser).map(({ user, tasks }) => `
    <div class="history-person-card">
      <h3>${avatarHtml(user, '')} ${user.name}</h3>
      ${tasks.length === 0 ? '<div class="empty-state">Sin tareas esa semana.</div>' : tasks.map(t => `
        <div class="history-task-row">
          <div>
            <div>${t.taskName} <span class="muted">(${t.frequencyLabel})</span>
              ${t.carriedOver ? '<span class="carried-badge">Atrasada</span>' : ''}
              ${t.manualEntry ? '<span class="manual-badge">Manual</span>' : ''}
            </div>
            ${t.status === 'done' ? `<div class="ht-when">Completada: ${formatDateTime(t.completedAt)}</div>` : '<div class="ht-when">' + statusLabel(t) + '</div>'}
          </div>
          <span class="badge status-${t.status}">${statusLabel(t)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  const swapsHtml = swaps.length === 0
    ? '<div class="empty-state">No hubo intercambios esa semana.</div>'
    : swaps.map(s => `
      <div class="swap-history-item">
        <div class="sh-top">
          <span>"${s.fromTaskName}" ⇄ "${s.toTaskName}"</span>
          <span class="badge status-${s.status}">${s.status === 'pending' ? 'Pendiente' : s.status === 'accepted' ? 'Aceptado' : 'Rechazado'}</span>
        </div>
        <div class="muted">${formatDateTime(s.createdAt)}</div>
        ${s.requestMessage ? `<div class="sh-msg">Pedido: "${s.requestMessage}"</div>` : ''}
        ${s.responseMessage ? `<div class="sh-msg">Respuesta: "${s.responseMessage}"</div>` : ''}
      </div>
    `).join('');

  content.innerHTML = `
    <div class="history-columns">${columnsHtml}</div>
    <h3>Intercambios de la semana</h3>
    ${swapsHtml}
  `;
}

// ---------------- Estadísticas (pie charts SVG hechos a mano) ----------------

// Dibuja un pie chart SVG con tooltip on-hover, dentro de containerEl.
// slices: [{ label, value, color }]
function renderPieChart(containerEl, slices, opts = {}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const size = opts.size || 180;
  const r = size / 2;
  const cx = r, cy = r;

  const wrap = document.createElement('div');
  wrap.className = 'pie-wrap';

  if (total === 0) {
    wrap.innerHTML = '<div class="stats-empty">Todavía no hay datos suficientes.</div>';
    containerEl.appendChild(wrap);
    return;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('pie-svg');

  let angle = -90; // empieza arriba
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  slices.forEach((slice, i) => {
    const pct = slice.value / total;
    const sweep = pct * 360;
    const startRad = (Math.PI / 180) * angle;
    const endRad = (Math.PI / 180) * (angle + sweep);
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = sweep > 180 ? 1 : 0;

    let d;
    if (slices.length === 1) {
      // círculo completo
      d = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
    } else {
      d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    }

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', slice.color || CHART_COLORS[i % CHART_COLORS.length]);
    path.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY + 14) + 'px';
      tooltip.textContent = `${slice.label}: ${slice.value} (${Math.round(pct * 100)}%)`;
    });
    path.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    svg.appendChild(path);

    angle += sweep;
  });

  const legend = document.createElement('div');
  legend.className = 'pie-legend';
  legend.innerHTML = slices.map((s, i) => `
    <div class="pie-legend-item">
      <span class="pie-legend-swatch" style="background:${s.color || CHART_COLORS[i % CHART_COLORS.length]}"></span>
      <span class="pie-legend-label">${s.label}</span>
      <span class="pie-legend-value">${s.value} (${Math.round((s.value / total) * 100)}%)</span>
    </div>
  `).join('');

  wrap.appendChild(svg);
  wrap.appendChild(legend);
  containerEl.appendChild(wrap);
}

async function loadStats() {
  const stats = await api('/stats');
  const content = document.getElementById('stats-content');
  content.innerHTML = '';

  if (stats.finishedWeeksCount === 0) {
    content.innerHTML = '<div class="stats-empty">Todavía no hay semanas cerradas para calcular estadísticas. Volvé cuando termine la primera semana completa.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  content.appendChild(grid);

  // 1) Cumplimiento general
  const card1 = document.createElement('div');
  card1.className = 'stat-card';
  card1.innerHTML = `<h3>Cumplimiento general</h3><div class="stat-subtitle">De todas las tareas asignadas en semanas ya cerradas (${stats.finishedWeeksCount} semanas)</div>`;
  grid.appendChild(card1);
  renderPieChart(card1, [
    { label: 'Completadas a tiempo', value: stats.overallCompletion.completed, color: '#6f8f6a' },
    { label: 'No completadas', value: stats.overallCompletion.notCompleted, color: '#c14b4b' }
  ]);

  // 2) Versus
  const card2 = document.createElement('div');
  card2.className = 'stat-card';
  card2.innerHTML = `<h3>Versus</h3><div class="stat-subtitle">Semanas en que cada uno completó el 100% de lo suyo</div>`;
  grid.appendChild(card2);
  renderPieChart(card2, stats.versus.map((v, i) => ({ label: v.name, value: v.perfectWeeks, color: CHART_COLORS[i % CHART_COLORS.length] })));

  // 3) Tareas más cumplidas / menos cumplidas
  const reliable = stats.taskReliability.filter(t => t.total > 0);
  const top5 = reliable.slice(0, 5);
  const bottom5 = [...reliable].reverse().slice(0, 5);

  const card3 = document.createElement('div');
  card3.className = 'stat-card';
  card3.innerHTML = `<h3>Tareas más cumplidas</h3><div class="stat-subtitle">% de veces que se completaron cuando tocaba (top 5)</div>`;
  grid.appendChild(card3);
  renderPieChart(card3, top5.map((t, i) => ({ label: t.taskName, value: t.completed, color: CHART_COLORS[i % CHART_COLORS.length] })));

  const card4 = document.createElement('div');
  card4.className = 'stat-card';
  card4.innerHTML = `<h3>Tareas menos cumplidas</h3><div class="stat-subtitle">Más veces quedaron sin completar a tiempo (top 5)</div>`;
  grid.appendChild(card4);
  renderPieChart(card4, bottom5.map((t, i) => ({ label: t.taskName, value: t.total - t.completed, color: CHART_COLORS[(i + 3) % CHART_COLORS.length] })));
}

boot();
