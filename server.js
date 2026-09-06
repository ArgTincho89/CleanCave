require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const cron = require('node-cron');
const { randomUUID } = require('crypto');

const { load, transaction } = require('./db/jsondb');
const { generateWeek, todayStr, lastCompletion, setManualCompletion } = require('./db/rotation');
const { FREQUENCIES, normalizeFrequencyLabel, daysForLabel } = require('./db/frequencies');
const { computeStats } = require('./db/stats');
const { sendPasswordResetEmail } = require('./db/mailer');
const { sendPush, isConfigured: pushConfigured } = require('./db/push');

const app = express();
const PORT = process.env.PORT || 3000;

// Los avatares viajan como base64 dentro del JSON, así que subimos el límite normal de express.json
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'household-tasks-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 días
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function currentWeekStart() {
  // Domingo de la semana que contiene el momento actual, con la semana
  // comenzando a las 08:00 del domingo (configurable vía TIMEZONE).
  // Si hoy es domingo antes de las 08:00, la semana actual es la ANTERIOR.
  const tz = process.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
  const local = getDateInTimezone(tz);
  let target = new Date(Date.UTC(local.year, local.month - 1, local.day));
  if (local.hour < 8) {
    target.setUTCDate(target.getUTCDate() - 1);
  }
  const day = target.getUTCDay();
  target.setUTCDate(target.getUTCDate() - day);
  return target.toISOString().slice(0, 10);
}

// Versión reducida de un usuario, segura para mostrarle a cualquier
// integrante del hogar (incluye avatar porque hace falta para pintarlo).
function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username, householdId: u.householdId, avatar: u.avatar || null };
}

// Versión completa, solo para que el usuario vea sus propios datos.
function fullProfile(u) {
  return { ...publicUser(u), recoveryEmail: u.recoveryEmail || '' };
}

function notifyPartnerIfDone(data, householdId, userId, weekStart) {
  const userAssignments = data.assignments.filter(
    a => a.householdId === householdId && a.assignedToUserId === userId && a.weekStart === weekStart
  );
  if (userAssignments.length === 0) return;
  const allDone = userAssignments.every(a => a.status === 'done');
  if (!allDone) return;

  const finisher = data.users.find(u => u.id === userId);
  const partners = data.users.filter(u => u.householdId === householdId && u.id !== userId);
  partners.forEach(p => {
    const already = data.notifications.find(
      n => n.type === 'info' && n.userId === p.id && n.message.includes(finisher.name) && n.message.includes(weekStart)
    );
    if (already) return;
    data.notifications.push({
      id: randomUUID(),
      userId: p.id,
      householdId,
      type: 'info',
      swapRequestId: null,
      message: `${finisher.name} ya completó todas sus tareas de esta semana. ¡Estás quedando mal, ponete en acción! 😅`,
      read: false,
      createdAt: new Date().toISOString()
    });
    sendPush({
      userIds: [p.id],
      title: '¡Semana completada! 🎉',
      body: `${finisher.name} ya terminó todo. ¡Dale que podés!`,
      url: '/'
    });
  });
}

// Devuelve año, mes, día y hora actual en una zona horaria concreta.
function getDateInTimezone(tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
  const parts = f.formatToParts(new Date());
  const p = (type) => parseInt(parts.find(x => x.type === type).value);
  return { year: p('year'), month: p('month'), day: p('day'), hour: p('hour'), minute: p('minute') };
}

// Genera la semana actual si todavía no existe ninguna asignación para ella.
// Así el listado aparece solo, sin depender de que alguien apriete un botón.
// Si recibe requestedWeekStart >= currentWeekStart(), usa esa semana para generar
// (cubre el caso de diferencia horaria entre frontend y servidor: si el navegador
// en Madrid ya está en domingo 08:00+ pero el servidor sigue en sábado, el frontend
// pide la semana nueva y el servidor la genera aunque su reloj todavía no cambió).
function ensureCurrentWeekGenerated(data, householdId, requestedWeekStart) {
  const current = currentWeekStart();
  const weekStart = (requestedWeekStart && requestedWeekStart >= current) ? requestedWeekStart : current;
  const household = data.households.find(h => h.id === householdId);
  if (!household) return weekStart;

  if (household.lastGeneratedWeek === weekStart) return weekStart;

  const hasAssignments = data.assignments.some(
    a => a.householdId === householdId && a.weekStart === weekStart
  );
  if (hasAssignments) {
    household.lastGeneratedWeek = weekStart;
    return weekStart;
  }

  generateWeek(data, householdId, weekStart);
  household.lastGeneratedWeek = weekStart;
  return weekStart;
}

// ---------- auth ----------

app.post('/api/auth/register-household', (req, res) => {
  const { householdName, members } = req.body; // members: [{name, username, password}, ...]
  if (!householdName || !Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'Falta el nombre del hogar o los integrantes.' });
  }
  for (const m of members) {
    if (!m.name || !m.username || !m.password) {
      return res.status(400).json({ error: 'Todos los integrantes necesitan nombre, usuario y contraseña.' });
    }
  }
  const data = load();
  const usernames = members.map(m => m.username.trim().toLowerCase());
  const taken = data.users.find(u => usernames.includes((u.username || '').toLowerCase()));
  if (taken) {
    return res.status(400).json({ error: `El usuario "${taken.username}" ya está en uso.` });
  }

  const result = transaction(d => {
    const household = {
      id: randomUUID(),
      name: householdName,
      cronDay: 0,
      cronHour: 8,
      createdAt: new Date().toISOString()
    };
    d.households.push(household);
    const createdUsers = members.map(m => {
      const u = {
        id: randomUUID(),
        householdId: household.id,
        name: m.name,
        username: m.username.trim().toLowerCase(),
        passwordHash: bcrypt.hashSync(m.password, 10),
        avatar: null,
        recoveryEmail: '',
        createdAt: new Date().toISOString()
      };
      d.users.push(u);
      return u;
    });
    return { household, createdUsers };
  });
  req.session.userId = result.createdUsers[0].id;
  req.session.householdId = result.household.id;
  res.json({ household: result.household, user: publicUser(result.createdUsers[0]) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const data = load();
  const user = data.users.find(u => (u.username || '').toLowerCase() === (username || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  req.session.userId = user.id;
  req.session.householdId = user.householdId;
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// El mensaje de respuesta es siempre igual exista o no el usuario/email, para
// no revelar qué usuarios existen. Si el usuario no tiene email de recuperación
// cargado en su perfil, no se puede hacer nada — se lo avisamos igual porque
// solo lo puede ver alguien que ya sabe el nombre de usuario.
app.post('/api/auth/forgot-password', async (req, res) => {
  const { username } = req.body;
  const data = load();
  const user = data.users.find(u => (u.username || '').toLowerCase() === (username || '').trim().toLowerCase());

  if (!user || !user.recoveryEmail) {
    return res.json({ ok: true, hasEmail: !!(user && user.recoveryEmail) });
  }

  const token = randomUUID().replace(/-/g, '');
  transaction(d => {
    d.passwordResets.push({
      id: randomUUID(),
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hora
      used: false,
      createdAt: new Date().toISOString()
    });
  });

  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const resetLink = `${appUrl}/reset-password.html?token=${token}`;
  await sendPasswordResetEmail(user.recoveryEmail, user.name, resetLink);

  res.json({ ok: true, hasEmail: true });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' });
  }
  const result = transaction(data => {
    const reset = data.passwordResets.find(r => r.token === token);
    if (!reset || reset.used || new Date(reset.expiresAt) < new Date()) return { error: 'invalid_token' };
    const user = data.users.find(u => u.id === reset.userId);
    if (!user) return { error: 'invalid_token' };
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    reset.used = true;
    return { ok: true };
  });
  if (result.error) return res.status(400).json({ error: 'El link no es válido o ya venció. Pedí uno nuevo.' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const data = load();
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  const household = data.households.find(h => h.id === user.householdId);
  const members = data.users.filter(u => u.householdId === user.householdId).map(publicUser);
  res.json({ user: fullProfile(user), household, members });
});

// ---------- perfil ----------

app.post('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' });
  }
  const result = transaction(data => {
    const user = data.users.find(u => u.id === req.session.userId);
    if (!bcrypt.compareSync(currentPassword || '', user.passwordHash)) return { error: 'wrong_password' };
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    return { ok: true };
  });
  if (result.error === 'wrong_password') return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  res.json({ ok: true });
});

app.put('/api/me/recovery-email', requireAuth, (req, res) => {
  const { email } = req.body;
  const user = transaction(data => {
    const u = data.users.find(u => u.id === req.session.userId);
    u.recoveryEmail = (email || '').trim();
    return u;
  });
  res.json({ user: fullProfile(user) });
});

app.put('/api/me/avatar', requireAuth, (req, res) => {
  const { avatarDataUrl } = req.body;
  if (avatarDataUrl && avatarDataUrl.length > 1_500_000) {
    return res.status(400).json({ error: 'La imagen es demasiado grande. Probá con una más chica.' });
  }
  const user = transaction(data => {
    const u = data.users.find(u => u.id === req.session.userId);
    u.avatar = avatarDataUrl || null;
    return u;
  });
  res.json({ user: fullProfile(user) });
});

// ---------- tasks ----------

app.get('/api/tasks', requireAuth, (req, res) => {
  const data = load();
  const tasks = data.tasks.filter(t => t.householdId === req.session.householdId);
  res.json({ tasks, frequencies: Object.keys(FREQUENCIES) });
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { name, frequencyLabel, customDays, description } = req.body;
  if (!name || !frequencyLabel) return res.status(400).json({ error: 'Falta nombre o frecuencia.' });

  let days;
  if (frequencyLabel === 'Personalizado') {
    days = parseInt(customDays, 10);
    if (!days || days <= 0) return res.status(400).json({ error: 'Días personalizados inválidos.' });
  } else {
    days = daysForLabel(frequencyLabel);
    if (!days) return res.status(400).json({ error: 'Frecuencia no reconocida.' });
  }

  const task = transaction(data => {
    const t = {
      id: randomUUID(),
      householdId: req.session.householdId,
      name,
      description: description || '',
      frequencyLabel,
      frequencyDays: days,
      active: true,
      createdAt: new Date().toISOString()
    };
    data.tasks.push(t);
    return t;
  });
  res.json({ task });
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, frequencyLabel, customDays, active, description } = req.body;
  const task = transaction(data => {
    const t = data.tasks.find(t => t.id === id && t.householdId === req.session.householdId);
    if (!t) return null;
    if (name !== undefined) t.name = name;
    if (description !== undefined) t.description = description;
    if (frequencyLabel !== undefined) {
      t.frequencyLabel = frequencyLabel;
      t.frequencyDays = frequencyLabel === 'Personalizado' ? parseInt(customDays, 10) : daysForLabel(frequencyLabel);
    }
    if (active !== undefined) t.active = active;
    return t;
  });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
  res.json({ task });
});

// Desactivar (soft): la tarea deja de entrar en el próximo reparto pero se conserva
// junto con todo su historial. Es lo que dispara el botón "Desactivar / Activar".
app.post('/api/tasks/:id/toggle-active', requireAuth, (req, res) => {
  const task = transaction(data => {
    const t = data.tasks.find(t => t.id === req.params.id && t.householdId === req.session.householdId);
    if (!t) return null;
    t.active = !t.active;
    return t;
  });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada.' });
  res.json({ task });
});

// Deja constancia manual de "esta tarea se hizo tal fecha, la hizo tal persona" —
// para arrancar la rotación con el historial real previo a usar la app.
// Queda como una entrada más en el Histórico (marcada como "registro manual").
app.post('/api/tasks/:id/set-last-completed', requireAuth, (req, res) => {
  const { userId, date } = req.body;
  if (!userId || !date) return res.status(400).json({ error: 'Falta la fecha o la persona.' });

  const result = transaction(data => {
    const task = data.tasks.find(t => t.id === req.params.id && t.householdId === req.session.householdId);
    if (!task) return { error: 'task_not_found' };
    const user = data.users.find(u => u.id === userId && u.householdId === req.session.householdId);
    if (!user) return { error: 'user_not_found' };
    const assignment = setManualCompletion(data, req.session.householdId, task, userId, date);
    return { assignment };
  });

  if (result.error === 'task_not_found') return res.status(404).json({ error: 'Tarea no encontrada.' });
  if (result.error === 'user_not_found') return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(result);
});

// Fija (pin) una tarea a una persona para un rango de semanas inclusivo. Al fijar,
// la semana actual se regenera en la misma transacción: si la tarea ya tenía una
// fila pendiente esta semana asignada a otra persona, el pin la reasigna (manda
// sobre el arrastre); las filas ya hechas (done) y las semanas pasadas quedan
// intactas. Quitar el pin ({ pinnedToUserId: null }) solo limpia los campos, sin
// regenerar ni re-mezclar la semana actual.
app.put('/api/tasks/:id/pin', requireAuth, (req, res) => {
  const { pinnedToUserId, pinnedFromWeek, pinnedToWeek } = req.body;
  const result = transaction(data => {
    const task = data.tasks.find(t => t.id === req.params.id && t.householdId === req.session.householdId);
    if (!task) return { error: 'task_not_found' };

    if (pinnedToUserId === null || pinnedToUserId === undefined) { // quitar pin: sin regeneración
      task.pinnedToUserId = null;
      task.pinnedFromWeek = null;
      task.pinnedToWeek = null;
      return { task };
    }

    if (!data.users.find(u => u.id === pinnedToUserId && u.householdId === req.session.householdId)) {
      return { error: 'user_not_found' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pinnedFromWeek || '') || !/^\d{4}-\d{2}-\d{2}$/.test(pinnedToWeek || '')) {
      return { error: 'invalid_week' };
    }
    if (pinnedFromWeek < currentWeekStart()) return { error: 'past_from' };
    if (pinnedToWeek < pinnedFromWeek) return { error: 'invalid_range' };

    task.pinnedToUserId = pinnedToUserId;
    task.pinnedFromWeek = pinnedFromWeek;
    task.pinnedToWeek = pinnedToWeek;
    // Regeneración idempotente de la semana actual dentro de la misma transacción.
    generateWeek(data, req.session.householdId, currentWeekStart());
    return { task };
  });

  if (result.error === 'task_not_found') return res.status(404).json({ error: 'Tarea no encontrada.' });
  if (result.error === 'user_not_found') return res.status(400).json({ error: 'La persona tiene que ser parte del hogar.' });
  if (result.error === 'invalid_week') return res.status(400).json({ error: 'Fechas inválidas.' });
  if (result.error === 'past_from') return res.status(400).json({ error: 'La semana de inicio no puede ser anterior a la actual.' });
  if (result.error === 'invalid_range') return res.status(400).json({ error: 'La semana final no puede ser anterior a la inicial.' });
  res.json(result);
});

// Eliminar (hard): borra la tarea definitivamente. El historial de asignaciones
// pasadas no se pierde porque cada asignación guarda su propio taskName/frequencyLabel.
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const ok = transaction(data => {
    const idx = data.tasks.findIndex(t => t.id === req.params.id && t.householdId === req.session.householdId);
    if (idx === -1) return false;
    data.tasks.splice(idx, 1);
    // Sacamos también cualquier asignación pendiente (no completada) que apuntara a esta tarea.
    data.assignments = data.assignments.filter(a => a.taskId !== req.params.id || a.status === 'done');
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Tarea no encontrada.' });
  res.json({ ok: true });
});

// ---------- assignments ----------

// Se deja disponible por si hace falta forzar una regeneración manual, pero el
// listado de la semana actual ya se genera solo al pedir /api/assignments.
app.post('/api/assignments/generate', requireAuth, (req, res) => {
  const weekStart = req.body.weekStart || currentWeekStart();
  const created = transaction(data => generateWeek(data, req.session.householdId, weekStart));
  res.json({ weekStart, created });
});

function enrichAssignment(a, tasksById, usersById) {
  const task = tasksById[a.taskId];
  return {
    ...a,
    taskName: a.taskName || task?.name || '(tarea eliminada)',
    frequencyLabel: a.frequencyLabel || task?.frequencyLabel,
    taskDescription: task?.description || '',
    assignedToName: usersById[a.assignedToUserId]?.name,
    carriedOver: !!a.carriedOver,
    manualEntry: !!a.manualEntry
  };
}

app.get('/api/assignments', requireAuth, (req, res) => {
  const requested = req.query.weekStart || currentWeekStart();

  // Autogeneración: si están pidiendo la semana en curso, o una semana
  // posterior (puede pasar si el navegador del usuario está en una zona
  // horaria más adelantada que el servidor), nos aseguramos de que ya
  // esté armada, sin depender de ningún botón ni del cron.
  let weekStart = requested;
  const current = currentWeekStart();
  if (requested === current || requested > current) {
    weekStart = transaction(d => ensureCurrentWeekGenerated(d, req.session.householdId, requested));
  }

  const fresh = load();
  const assignments = fresh.assignments.filter(
    a => a.householdId === req.session.householdId && a.weekStart === weekStart
  );
  const tasksById = Object.fromEntries(fresh.tasks.map(t => [t.id, t]));
  const usersById = Object.fromEntries(fresh.users.map(u => [u.id, u]));

  const enriched = assignments.map(a => enrichAssignment(a, tasksById, usersById));

  const byUser = {};
  fresh.users.filter(u => u.householdId === req.session.householdId).forEach(u => {
    byUser[u.id] = { user: publicUser(u), tasks: enriched.filter(a => a.assignedToUserId === u.id) };
  });

  res.json({ weekStart, byUser, all: enriched, currentUserId: req.session.userId });
});

app.post('/api/assignments/:id/complete', requireAuth, (req, res) => {
  const result = transaction(data => {
    const a = data.assignments.find(a => a.id === req.params.id && a.householdId === req.session.householdId);
    if (!a) return { error: 'not_found' };
    if (a.assignedToUserId !== req.session.userId) return { error: 'forbidden' };
    if (a.status === 'done') return { error: 'already_done' };
    a.status = 'done';
    a.completedAt = new Date().toISOString();
    a.completedByUserId = req.session.userId;
    notifyPartnerIfDone(data, req.session.householdId, a.assignedToUserId, a.weekStart);
    return { assignment: a };
  });
  if (result.error === 'not_found') return res.status(404).json({ error: 'Asignación no encontrada.' });
  if (result.error === 'forbidden') return res.status(403).json({ error: 'Solo podés marcar tus propias tareas.' });
  if (result.error === 'already_done') return res.status(400).json({ error: 'Esta tarea ya estaba marcada como hecha.' });
  res.json(result);
});

// ---------- intercambios de tareas ----------

app.post('/api/swaps', requireAuth, (req, res) => {
  const { fromAssignmentId, toAssignmentId, message } = req.body;
  if (!fromAssignmentId || !toAssignmentId) {
    return res.status(400).json({ error: 'Elegí tu tarea y la tarea que querés a cambio.' });
  }
  const result = transaction(data => {
    const from = data.assignments.find(a => a.id === fromAssignmentId && a.householdId === req.session.householdId);
    const to = data.assignments.find(a => a.id === toAssignmentId && a.householdId === req.session.householdId);
    if (!from || !to) return { error: 'not_found' };
    if (from.assignedToUserId !== req.session.userId) return { error: 'not_yours' };
    if (to.assignedToUserId === req.session.userId) return { error: 'same_user' };
    if (from.status === 'done' || to.status === 'done') return { error: 'already_done' };

    const tasksById = Object.fromEntries(data.tasks.map(t => [t.id, t]));
    const swap = {
      id: randomUUID(),
      householdId: req.session.householdId,
      weekStart: to.weekStart,
      fromUserId: from.assignedToUserId,
      fromAssignmentId: from.id,
      fromTaskName: from.taskName || tasksById[from.taskId]?.name || '(tarea eliminada)',
      toUserId: to.assignedToUserId,
      toAssignmentId: to.id,
      toTaskName: to.taskName || tasksById[to.taskId]?.name || '(tarea eliminada)',
      requestMessage: message || '',
      responseMessage: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      respondedAt: null
    };
    data.swapRequests.push(swap);

    const requester = data.users.find(u => u.id === swap.fromUserId);
    data.notifications.push({
      id: randomUUID(),
      userId: swap.toUserId,
      householdId: req.session.householdId,
      type: 'swap_request',
      swapRequestId: swap.id,
      message: `${requester.name} te pide intercambiar su tarea "${swap.fromTaskName}" por tu tarea "${swap.toTaskName}".${message ? ` Mensaje: "${message}"` : ''}`,
      read: false,
      createdAt: new Date().toISOString()
    });

    sendPush({
      userIds: [swap.toUserId],
      title: 'Solicitud de intercambio',
      body: `${requester.name} quiere cambiar "${swap.fromTaskName}" por "${swap.toTaskName}".${message ? ` Dice: "${message}"` : ''}`,
      url: '/'
    });

    return { swap };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: 'Alguna de las tareas no existe.' });
  if (result.error === 'not_yours') return res.status(403).json({ error: 'La tarea que ofrecés tiene que ser tuya.' });
  if (result.error === 'same_user') return res.status(400).json({ error: 'Elegí una tarea de la otra persona.' });
  if (result.error === 'already_done') return res.status(400).json({ error: 'No se puede intercambiar una tarea ya completada.' });
  res.json(result);
});

app.post('/api/swaps/:id/respond', requireAuth, (req, res) => {
  const { decision, responseMessage } = req.body; // decision: 'accept' | 'deny'
  if (!['accept', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'Decisión inválida.' });
  }
  const result = transaction(data => {
    const swap = data.swapRequests.find(s => s.id === req.params.id && s.householdId === req.session.householdId);
    if (!swap) return { error: 'not_found' };
    if (swap.toUserId !== req.session.userId) return { error: 'forbidden' };
    if (swap.status !== 'pending') return { error: 'already_responded' };

    swap.status = decision === 'accept' ? 'accepted' : 'denied';
    swap.responseMessage = responseMessage || '';
    swap.respondedAt = new Date().toISOString();

    if (decision === 'accept') {
      const from = data.assignments.find(a => a.id === swap.fromAssignmentId);
      const to = data.assignments.find(a => a.id === swap.toAssignmentId);
      if (from && to && from.status !== 'done' && to.status !== 'done') {
        from.assignedToUserId = swap.toUserId;
        to.assignedToUserId = swap.fromUserId;
      }
    }

    // La notificación original de pedido de intercambio queda marcada como leída.
    const original = data.notifications.find(n => n.swapRequestId === swap.id && n.type === 'swap_request');
    if (original) original.read = true;

    const responder = data.users.find(u => u.id === swap.toUserId);
    data.notifications.push({
      id: randomUUID(),
      userId: swap.fromUserId,
      householdId: req.session.householdId,
      type: 'swap_response',
      swapRequestId: swap.id,
      message: decision === 'accept'
        ? `${responder.name} aceptó cambiar "${swap.toTaskName}" por "${swap.fromTaskName}".${responseMessage ? ` Mensaje: "${responseMessage}"` : ''}`
        : `${responder.name} no aceptó el cambio de "${swap.toTaskName}" por "${swap.fromTaskName}".${responseMessage ? ` Mensaje: "${responseMessage}"` : ''}`,
      read: false,
      createdAt: new Date().toISOString()
    });

    sendPush({
      userIds: [swap.fromUserId],
      title: decision === 'accept' ? 'Intercambio aceptado ✅' : 'Intercambio rechazado ❌',
      body: decision === 'accept'
        ? `${responder.name} aceptó cambiar "${swap.toTaskName}" por "${swap.fromTaskName}".`
        : `${responder.name} no aceptó cambiar "${swap.toTaskName}" por "${swap.fromTaskName}".`,
      url: '/'
    });

    return { swap };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: 'Solicitud no encontrada.' });
  if (result.error === 'forbidden') return res.status(403).json({ error: 'Esta solicitud no es para vos.' });
  if (result.error === 'already_responded') return res.status(400).json({ error: 'Esta solicitud ya fue respondida.' });
  res.json(result);
});

app.get('/api/swaps', requireAuth, (req, res) => {
  const weekStart = req.query.weekStart;
  const data = load();
  let swaps = data.swapRequests.filter(s => s.householdId === req.session.householdId);
  if (weekStart) swaps = swaps.filter(s => s.weekStart === weekStart);
  swaps = swaps.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ swaps });
});

// ---------- propuestas de configuración semanal ----------
//
// El usuario "Configurar semana" permite reasignar manualmente a quién le toca
// cada tarea de la semana en curso. En lugar de aplicarlo directo, se crea una
// propuesta y se notifica al resto de los integrantes del hogar. La propuesta
// recién se aplica cuando TODOS los demás la aceptan (quien la propuso ya
// manifestó su voluntad al crearla); si cualquiera la rechaza, se descarta y
// la semana queda como estaba.

function weekProposalVoters(proposal, data) {
  return data.users.filter(u => u.householdId === proposal.householdId && u.id !== proposal.proposedByUserId);
}

// Devuelve la versión "pública" de una propuesta lista para el frontend:
// cuántos aceptaron, cuántos faltan, y los nombres resueltos.
function publicWeekProposal(proposal, data) {
  const voters = weekProposalVoters(proposal, data);
  const respondents = Object.keys(proposal.responses || {});
  const acceptedCount = Object.values(proposal.responses || {}).filter(d => d === 'accept').length;
  const usersById = Object.fromEntries(data.users.map(u => [u.id, u]));

  const changes = (proposal.changes || []).map(c => ({
    ...c,
    fromUserName: usersById[c.fromUserId]?.name || '?',
    toUserName: usersById[c.toUserId]?.name || '?'
  }));

  return {
    ...proposal,
    // El proponente ya manifestó su voluntad al proponer: los votantes son
    // los demás integrantes del hogar.
    totalVoters: voters.length,
    acceptedCount,
    respondedCount: respondents.length,
    allResponded: respondents.length === voters.length,
    changes
  };
}

// Crea una propuesta y notifica al resto del hogar.
app.post('/api/week-proposals', requireAuth, (req, res) => {
  const { weekStart, changes } = req.body; // changes: [{ assignmentId, toUserId }]
  if (!weekStart || !Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: 'Falta la semana o la lista de cambios.' });
  }

  const result = transaction(data => {
    const proposer = data.users.find(u => u.id === req.session.userId);
    if (!proposer) return { error: 'not_found' };

    // Solo una propuesta pendiente por semana: si ya hay una esperando
    // respuesta, no se puede proponer otra encima (evita que se pisen).
    const pendingExists = (data.weekProposals || []).some(
      p => p.householdId === req.session.householdId && p.weekStart === weekStart && p.status === 'pending'
    );
    if (pendingExists) return { error: 'pending_exists' };

    // Validar cada cambio: la asignación pertenece al hogar, es de la semana
    // indicada, está pendiente (las hechas no se reasignan) y el destinatario
    // es miembro del hogar.
    const validated = [];
    for (const ch of changes) {
      const assignment = data.assignments.find(
        a => a.id === ch.assignmentId && a.householdId === req.session.householdId
      );
      if (!assignment) return { error: 'assignment_not_found' };
      if (assignment.weekStart !== weekStart) return { error: 'wrong_week' };
      if (assignment.status !== 'pending') return { error: 'already_done' };
      const toUser = data.users.find(
        u => u.id === ch.toUserId && u.householdId === req.session.householdId
      );
      if (!toUser) return { error: 'user_not_found' };
      validated.push({
        assignmentId: assignment.id,
        taskName: assignment.taskName || '(tarea)',
        fromUserId: assignment.assignedToUserId,
        toUserId: ch.toUserId
      });
    }

    const proposal = {
      id: randomUUID(),
      householdId: req.session.householdId,
      weekStart,
      proposedByUserId: proposer.id,
      proposedByUserName: proposer.name,
      changes: validated,
      status: 'pending',
      responses: {}, // { [userId]: 'accept'|'deny' }
      createdAt: new Date().toISOString(),
      respondedAt: null
    };
    data.weekProposals = data.weekProposals || [];
    data.weekProposals.push(proposal);

    // Notificar a todos los integrantes del hogar excepto quien la propuso.
    const partners = data.users.filter(u => u.householdId === req.session.householdId && u.id !== proposer.id);
    partners.forEach(p => {
      data.notifications.push({
        id: randomUUID(),
        userId: p.id,
        householdId: req.session.householdId,
        type: 'week_proposal',
        weekProposalId: proposal.id,
        message: `${proposer.name} propuso una nueva configuración para la semana en curso. Revisala y aceptá o rechazá.`,
        read: false,
        createdAt: new Date().toISOString()
      });
      sendPush({
        userIds: [p.id],
        title: 'Nueva configuración de semana',
        body: `${proposer.name} propuso una redistribución de tareas. ¿La aceptás?`,
        url: '/'
      });
    });

    return { proposal };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: 'No autenticado.' });
  if (result.error === 'pending_exists') return res.status(400).json({ error: 'Ya hay una propuesta pendiente para la semana. Esperá a que la respondan o la rechacen.' });
  if (result.error === 'assignment_not_found') return res.status(400).json({ error: 'Alguna de las tareas no pertenece a esta semana.' });
  if (result.error === 'wrong_week') return res.status(400).json({ error: 'Alguna de las tareas no es de la semana indicada.' });
  if (result.error === 'already_done') return res.status(400).json({ error: 'No se puede reasignar una tarea ya completada.' });
  if (result.error === 'user_not_found') return res.status(400).json({ error: 'La persona destino tiene que ser parte del hogar.' });

  const data = load();
  res.json({ proposal: publicWeekProposal(result.proposal, data) });
});

// Responde una propuesta. El consenso es "todos deben aceptar": la propuesta
// se aplica recién cuando todos los integrantes aceptaron; si cualquiera
// rechaza, se descarta y la semana queda como estaba.
app.post('/api/week-proposals/:id/respond', requireAuth, (req, res) => {
  const { decision } = req.body; // 'accept' | 'deny'
  if (!['accept', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'Decisión inválida.' });
  }

  const result = transaction(data => {
    const proposal = data.weekProposals.find(
      p => p.id === req.params.id && p.householdId === req.session.householdId
    );
    if (!proposal) return { error: 'not_found' };
    if (proposal.proposedByUserId === req.session.userId) return { error: 'own_proposal' };
    if (proposal.status !== 'pending') return { error: 'already_responded' };
    if (proposal.responses[req.session.userId]) return { error: 'already_responded' };

    proposal.responses[req.session.userId] = decision;
    proposal.respondedAt = new Date().toISOString();

    // Los votantes son todos los integrantes EXCEPTO quien propuso: ese ya
    // manifestó su voluntad al crear la propuesta.
    const voters = data.users.filter(u => u.householdId === req.session.householdId && u.id !== proposal.proposedByUserId);
    const allResponded = voters.every(v => proposal.responses[v.id]);
    const anyDenied = Object.values(proposal.responses).some(d => d === 'deny');

    if (anyDenied) {
      // Alguien rechazó: se descarta. Todo queda como estaba.
      proposal.status = 'denied';
    } else if (allResponded) {
      // Todos aceptaron: se aplica la nueva configuración.
      proposal.status = 'accepted';
      for (const ch of proposal.changes) {
        const assignment = data.assignments.find(a => a.id === ch.assignmentId);
        if (assignment) assignment.assignedToUserId = ch.toUserId;
      }
    }
    // Si falta alguien por responder, sigue 'pending'.

    // Marcar como leída la notificación de propuesta asociada a este usuario.
    data.notifications
      .filter(n => n.weekProposalId === proposal.id && n.type === 'week_proposal' && n.userId === req.session.userId)
      .forEach(n => { n.read = true; });

    // Cuando la propuesta se cierra (aceptada o denegada), notificar a todos.
    if (proposal.status !== 'pending') {
      const reason = proposal.status === 'denied'
        ? 'alguien la rechazó, así que la semana queda como estaba.'
        : 'todos la aceptaron, así que se aplicó la nueva configuración.';
      data.users.filter(u => u.householdId === proposal.householdId).forEach(u => {
        data.notifications.push({
          id: randomUUID(),
          userId: u.id,
          householdId: proposal.householdId,
          type: 'week_proposal_result',
          weekProposalId: proposal.id,
          message: `La propuesta de configuración de la semana fue ${proposal.status === 'accepted' ? 'aceptada' : 'rechazada'}: ${reason}`,
          read: false,
          createdAt: new Date().toISOString()
        });
        sendPush({
          userIds: [u.id],
          title: proposal.status === 'accepted' ? 'Configuración aplicada ✅' : 'Configuración descartada ❌',
          body: reason,
          url: '/'
        });
      });
    }

    return { proposal };
  });

  if (result.error === 'not_found') return res.status(404).json({ error: 'Propuesta no encontrada.' });
  if (result.error === 'own_proposal') return res.status(403).json({ error: 'No podés responder a tu propia propuesta.' });
  if (result.error === 'already_responded') return res.status(400).json({ error: 'Ya respondiste esta propuesta.' });

  const data = load();
  res.json({ proposal: publicWeekProposal(result.proposal, data) });
});

app.get('/api/week-proposals', requireAuth, (req, res) => {
  const data = load();
  const proposals = (data.weekProposals || [])
    .filter(p => p.householdId === req.session.householdId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ proposals: proposals.map(p => publicWeekProposal(p, data)) });
});

// ---------- histórico ----------

app.get('/api/weeks', requireAuth, (req, res) => {
  const data = load();
  const weeks = new Set();
  data.assignments.filter(a => a.householdId === req.session.householdId).forEach(a => weeks.add(a.weekStart));
  const sorted = [...weeks].sort((a, b) => (a < b ? 1 : -1));
  res.json({ weeks: sorted });
});

app.get('/api/history', requireAuth, (req, res) => {
  const weekStart = req.query.weekStart;
  if (!weekStart) return res.status(400).json({ error: 'Falta la semana.' });
  const data = load();

  const assignments = data.assignments.filter(a => a.householdId === req.session.householdId && a.weekStart === weekStart);
  const tasksById = Object.fromEntries(data.tasks.map(t => [t.id, t]));
  const usersById = Object.fromEntries(data.users.map(u => [u.id, u]));

  const enriched = assignments.map(a => enrichAssignment(a, tasksById, usersById));

  const byUser = {};
  data.users.filter(u => u.householdId === req.session.householdId).forEach(u => {
    byUser[u.id] = { user: publicUser(u), tasks: enriched.filter(a => a.assignedToUserId === u.id) };
  });

  const swaps = data.swapRequests
    .filter(s => s.householdId === req.session.householdId && s.weekStart === weekStart)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  res.json({ weekStart, byUser, swaps });
});

// ---------- estadísticas ----------

app.get('/api/stats', requireAuth, (req, res) => {
  const data = load();
  const stats = computeStats(data, req.session.householdId, currentWeekStart());
  res.json(stats);
});

// ---------- notifications ----------

app.get('/api/notifications', requireAuth, (req, res) => {
  const data = load();
  const notifications = data.notifications
    .filter(n => n.userId === req.session.userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ notifications });
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  transaction(data => {
    const n = data.notifications.find(n => n.id === req.params.id && n.userId === req.session.userId);
    if (n) n.read = true;
  });
  res.json({ ok: true });
});

// ---------- OneSignal push registration ----------

app.post('/api/push/register', requireAuth, (req, res) => {
  const { oneSignalUserId } = req.body;
  if (!oneSignalUserId) return res.status(400).json({ error: 'Falta oneSignalUserId.' });
  transaction(data => {
    const u = data.users.find(u => u.id === req.session.userId);
    if (u) u.oneSignalUserId = oneSignalUserId;
  });
  res.json({ ok: true });
});

// ---------- tareas globales ----------

app.get('/api/global-tasks', requireAuth, (req, res) => {
  const data = load();
  const tasks = (data.globalTasks || [])
    .filter(t => t.householdId === req.session.householdId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ tasks });
});

app.post('/api/global-tasks', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta el nombre de la tarea.' });
  const task = transaction(data => {
    const user = data.users.find(u => u.id === req.session.userId);
    const t = {
      id: randomUUID(),
      householdId: req.session.householdId,
      name,
      description: description || '',
      createdByUserId: req.session.userId,
      createdByUserName: user ? user.name : '',
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedByUserId: null,
      completedByUserName: null,
      status: 'pending'
    };
    data.globalTasks = data.globalTasks || [];
    data.globalTasks.push(t);
    data.globalTaskHistory = data.globalTaskHistory || [];
    data.globalTaskHistory.push({
      id: randomUUID(),
      householdId: req.session.householdId,
      taskId: t.id,
      taskName: name,
      action: 'created',
      userName: user ? user.name : '',
      userId: req.session.userId,
      timestamp: new Date().toISOString()
    });
    return t;
  });
  res.json({ task });
});

app.put('/api/global-tasks/:id', requireAuth, (req, res) => {
  const { name, description } = req.body;
  const task = transaction(data => {
    if (!data.globalTasks) return null;
    const t = data.globalTasks.find(x => x.id === req.params.id && x.householdId === req.session.householdId);
    if (!t) return null;
    if (name !== undefined) t.name = name;
    if (description !== undefined) t.description = description;
    return t;
  });
  if (!task) return res.status(404).json({ error: 'Tarea global no encontrada.' });
  res.json({ task });
});

app.post('/api/global-tasks/:id/toggle', requireAuth, (req, res) => {
  const task = transaction(data => {
    if (!data.globalTasks) return null;
    const t = data.globalTasks.find(x => x.id === req.params.id && x.householdId === req.session.householdId);
    if (!t) return null;
    const user = data.users.find(u => u.id === req.session.userId);
    const userName = user ? user.name : '';
    data.globalTaskHistory = data.globalTaskHistory || [];
    if (t.status === 'pending') {
      t.status = 'done';
      t.completedAt = new Date().toISOString();
      t.completedByUserId = req.session.userId;
      t.completedByUserName = userName;
      data.globalTaskHistory.push({
        id: randomUUID(), householdId: req.session.householdId, taskId: t.id, taskName: t.name,
        action: 'completed', userName, userId: req.session.userId, timestamp: new Date().toISOString()
      });
    } else {
      t.status = 'pending';
      t.completedAt = null;
      t.completedByUserId = null;
      t.completedByUserName = null;
      data.globalTaskHistory.push({
        id: randomUUID(), householdId: req.session.householdId, taskId: t.id, taskName: t.name,
        action: 'reopened', userName, userId: req.session.userId, timestamp: new Date().toISOString()
      });
    }
    return t;
  });
  if (!task) return res.status(404).json({ error: 'Tarea global no encontrada.' });
  res.json({ task });
});

app.delete('/api/global-tasks/:id', requireAuth, (req, res) => {
  const ok = transaction(data => {
    if (!data.globalTasks) return false;
    const idx = data.globalTasks.findIndex(x => x.id === req.params.id && x.householdId === req.session.householdId);
    if (idx === -1) return false;
    const deleted = data.globalTasks[idx];
    data.globalTaskHistory = data.globalTaskHistory || [];
    const user = data.users.find(u => u.id === req.session.userId);
    data.globalTaskHistory.push({
      id: randomUUID(), householdId: req.session.householdId, taskId: deleted.id, taskName: deleted.name,
      action: 'deleted', userName: user ? user.name : '', userId: req.session.userId, timestamp: new Date().toISOString()
    });
    data.globalTasks.splice(idx, 1);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Tarea global no encontrada.' });
  res.json({ ok: true });
});

app.get('/api/global-tasks/history', requireAuth, (req, res) => {
  const data = load();
  const history = (data.globalTaskHistory || [])
    .filter(h => h.householdId === req.session.householdId)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 100);
  res.json({ history });
});

// ---------- cron: generación automática semanal ----------
// Se ejecuta los domingos a las 8:00 (timezone configurable vía TIMEZONE,
// default America/Argentina/Buenos_Aires) y genera la lista para todos los
// hogares. Usa lastGeneratedWeek para no duplicar si ya se generó.
const cronTimezone = process.env.TIMEZONE || 'America/Argentina/Buenos_Aires';
const cronTask = cron.schedule('0 8 * * 0', () => {
  const data = load();
  const weekStart = currentWeekStart();
  data.households.forEach(h => {
    if (h.lastGeneratedWeek === weekStart) return;
    transaction(d => {
      generateWeek(d, h.id, weekStart);
      const house = d.households.find(x => x.id === h.id);
      if (house) house.lastGeneratedWeek = weekStart;
    });
    console.log(`[cron] Lista semanal generada para el hogar "${h.name}"`);
  });
}, { timezone: cronTimezone });

// En tests detenemos el cron para que el proceso pueda terminar.
if (process.env.NODE_ENV === 'test') {
  cronTask.stop();
}

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CleanCave corriendo en http://0.0.0.0:${PORT}`);
  });
}

module.exports = { app };
