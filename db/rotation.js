const { randomUUID } = require('crypto');

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Domingo de la semana que contiene esa fecha. Esta función recibe solo una
// fecha (sin hora), por lo que NO aplica el cutoff de las 08:00 (a diferencia
// de currentWeekStart en server.js que sí lo hace para el momento actual).
function weekStartFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

// Devuelve, para una tarea, cuál fue su última realización (assignment done)
// dentro del hogar, ordenando por fecha de finalización descendente.
function lastCompletion(data, taskId) {
  const done = data.assignments
    .filter(a => a.taskId === taskId && a.status === 'done' && a.completedAt)
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  return done[0] || null;
}

// Traslada a la semana actual las tareas que quedaron pendientes de semanas
// anteriores, SIN rotar de persona: se quedan con quien no las terminó, para
// que la carga de no cumplir la sufra esa misma persona (y no su pareja).
// La fila vieja pasa a status "carried" (se conserva para el histórico).
// Devuelve el set de taskIds trasladados, para que el reparto normal no
// vuelva a asignarlos por su cuenta, y actualiza loadByUser en el lugar.
function carryOverPending(data, householdId, weekStart, activeTaskIds, loadByUser) {
  const carriedTaskIds = new Set();

  // Tomamos la asignación pendiente más reciente de cada tarea que haya
  // quedado sin completar en alguna semana anterior a la actual.
  const overdueByTask = new Map();
  data.assignments
    .filter(a => a.householdId === householdId && a.status === 'pending' && a.weekStart < weekStart)
    .forEach(a => {
      const prev = overdueByTask.get(a.taskId);
      if (!prev || a.weekStart > prev.weekStart) overdueByTask.set(a.taskId, a);
    });

  for (const [taskId, oldAssignment] of overdueByTask) {
    if (!activeTaskIds.has(taskId)) continue; // la tarea se desactivó/eliminó: no se arrastra
    const already = data.assignments.find(a => a.taskId === taskId && a.weekStart === weekStart);
    if (already) continue;

    oldAssignment.status = 'carried';
    oldAssignment.carriedAt = new Date().toISOString();

    const carried = {
      id: randomUUID(),
      taskId,
      taskName: oldAssignment.taskName,
      frequencyLabel: oldAssignment.frequencyLabel,
      householdId,
      weekStart,
      assignedToUserId: oldAssignment.assignedToUserId,
      status: 'pending',
      completedAt: null,
      completedByUserId: null,
      carriedOver: true,
      carriedFromWeek: oldAssignment.weekStart,
      createdAt: new Date().toISOString()
    };
    data.assignments.push(carried);
    carriedTaskIds.add(taskId);
    loadByUser[carried.assignedToUserId] = (loadByUser[carried.assignedToUserId] || 0) + 1;
  }

  return carriedTaskIds;
}

// Genera (o completa) la lista de tareas de la semana que arranca en weekStart.
// Reglas:
//  - Primero se trasladan las tareas que quedaron pendientes de semanas
//    anteriores: se quedan con la misma persona (ver carryOverPending) y
//    cuentan para su carga de esta semana.
//  - Para el resto: una tarea "vence" si nunca se hizo, o si next_due
//    (última vez + frecuencia) cae dentro de la ventana [weekStart, weekStart+6]
//    o ya quedó vencida antes.
//  - La persona asignada rota: nunca la misma persona dos veces seguidas en la
//    misma tarea. Si la tarea es nueva (sin historial), se reparte balanceando
//    la carga total de la semana entre los integrantes del hogar — y como las
//    trasladadas ya suman a la carga de quien las dejó pendiente, el balanceo
//    tiende a darle las tareas nuevas a la otra persona.
function generateWeek(data, householdId, weekStart) {
  const members = data.users
    .filter(u => u.householdId === householdId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  if (members.length === 0) {
    throw new Error('El hogar no tiene integrantes todavía.');
  }

  const tasks = data.tasks.filter(t => t.householdId === householdId && t.active);
  const activeTaskIds = new Set(tasks.map(t => t.id));
  const windowEnd = addDays(weekStart, 6);

  // Si una tarea se desactivó después de haber sido asignada esta semana,
  // sacamos esa asignación de la lista siempre que todavía esté pendiente
  // (no se toca el historial de tareas ya marcadas como hechas o trasladadas).
  data.assignments = data.assignments.filter(a => {
    if (a.householdId !== householdId || a.weekStart !== weekStart) return true;
    if (a.status !== 'pending') return true;
    return activeTaskIds.has(a.taskId);
  });

  // Cuántas tareas tiene ya asignadas cada persona en esta semana (para balancear).
  const loadByUser = {};
  members.forEach(m => { loadByUser[m.id] = 0; });
  data.assignments
    .filter(a => a.householdId === householdId && a.weekStart === weekStart)
    .forEach(a => { loadByUser[a.assignedToUserId] = (loadByUser[a.assignedToUserId] || 0) + 1; });

  const carriedTaskIds = carryOverPending(data, householdId, weekStart, activeTaskIds, loadByUser);

  const created = [];

  for (const task of tasks) {
    if (carriedTaskIds.has(task.id)) continue; // ya se trasladó pendiente de una semana anterior
    const already = data.assignments.find(a => a.taskId === task.id && a.weekStart === weekStart);
    if (already) continue; // ya generada para esta semana, no duplicar

    const last = lastCompletion(data, task.id);
    let due;
    if (!last) {
      due = true; // nunca se hizo -> corresponde asignarla
    } else {
      const nextDue = addDays(last.completedAt.slice(0, 10), task.frequencyDays);
      due = nextDue <= windowEnd;
    }
    if (!due) continue;

    let assignedTo;
    if (last) {
      // Rotar: le toca a cualquiera que NO sea quien la hizo la última vez.
      const others = members.filter(m => m.id !== last.assignedToUserId);
      if (others.length > 0) {
        // entre los "otros" candidatos, elegir el de menor carga actual
        others.sort((a, b) => loadByUser[a.id] - loadByUser[b.id]);
        assignedTo = others[0].id;
      } else {
        assignedTo = members[0].id; // hogar de 1 sola persona (caso límite)
      }
    } else {
      // Tarea nueva: asignar a quien tenga menos carga acumulada esta semana.
      const sorted = [...members].sort((a, b) => loadByUser[a.id] - loadByUser[b.id]);
      assignedTo = sorted[0].id;
    }

    loadByUser[assignedTo] = (loadByUser[assignedTo] || 0) + 1;

    const assignment = {
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,             // snapshot: sobrevive aunque la tarea se edite o elimine después
      frequencyLabel: task.frequencyLabel,
      householdId,
      weekStart,
      assignedToUserId: assignedTo,
      status: 'pending',
      completedAt: null,
      completedByUserId: null,
      createdAt: new Date().toISOString()
    };
    data.assignments.push(assignment);
    created.push(assignment);
  }

  return created;
}

// Registra manualmente "esta tarea se hizo por última vez tal fecha, la hizo
// tal persona" — para poder arrancar la rotación con el historial real previo
// a usar la app. Crea una asignación "done" marcada como manualEntry para que
// quede visible en el Histórico de la semana correspondiente a esa fecha.
function setManualCompletion(data, householdId, task, userId, dateStr) {
  const weekStart = weekStartFor(dateStr);
  const assignment = {
    id: randomUUID(),
    taskId: task.id,
    taskName: task.name,
    frequencyLabel: task.frequencyLabel,
    householdId,
    weekStart,
    assignedToUserId: userId,
    status: 'done',
    completedAt: dateStr + 'T12:00:00.000Z',
    completedByUserId: userId,
    manualEntry: true,
    createdAt: new Date().toISOString()
  };
  data.assignments.push(assignment);
  return assignment;
}

module.exports = { generateWeek, lastCompletion, addDays, todayStr, weekStartFor, setManualCompletion };
