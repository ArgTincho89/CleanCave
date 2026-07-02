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
  // Domingo de la semana actual, como identificador de la semana.
  const d = new Date();
  const day = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
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

// Genera la semana actual si todavía no existe ninguna asignación para ella.
// Así el listado aparece solo, sin depender de que alguien apriete un botón.
function ensureCurrentWeekGenerated(data, householdId) {
  const weekStart = currentWeekStart();
  generateWeek(data, householdId, weekStart); // idempotente: no duplica ni si ya existían algunas
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

  // Autogeneración: si están pidiendo la semana en curso, nos aseguramos de
  // que ya esté armada, sin depender de ningún botón ni del cron.
  let weekStart = requested;
  if (requested === currentWeekStart()) {
    weekStart = transaction(d => ensureCurrentWeekGenerated(d, req.session.householdId));
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

// ---------- cron: generación automática semanal ----------
// Por defecto domingo (día 0) a las 8:00, configurable por hogar (cronDay/cronHour).
// node-cron corre cada hora y chequea qué hogares "matchean" ese día/hora.
// (El servidor tiene que estar prendido en ese momento; al hostearlo esto corre 24/7.)
const cronTask = cron.schedule('0 * * * *', () => {
  const data = load();
  const now = new Date();
  data.households.forEach(h => {
    if (now.getDay() === (h.cronDay ?? 0) && now.getHours() === (h.cronHour ?? 8)) {
      transaction(d => generateWeek(d, h.id, currentWeekStart()));
      console.log(`[cron] Lista semanal generada para el hogar "${h.name}"`);
    }
  });
});

// En tests detenemos el cron para que el proceso pueda terminar.
if (process.env.NODE_ENV === 'test') {
  cronTask.stop();
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CleanCave corriendo en http://localhost:${PORT}`);
  });
}

module.exports = { app };
