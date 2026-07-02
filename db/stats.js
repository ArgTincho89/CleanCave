// Calcula las métricas para la pestaña "Estadísticas".
// Solo se consideran semanas "cerradas" (weekStart anterior a la semana
// actual): la semana en curso todavía puede completarse, así que no cuenta
// ni a favor ni en contra todavía.

function computeStats(data, householdId, currentWeekStart) {
  const finished = data.assignments.filter(
    a => a.householdId === householdId && a.weekStart < currentWeekStart
  );
  const usersById = Object.fromEntries(
    data.users.filter(u => u.householdId === householdId).map(u => [u.id, u])
  );

  // 1) Cumplimiento general: completadas vs no completadas (pendiente o trasladada).
  const completed = finished.filter(a => a.status === 'done').length;
  const notCompleted = finished.filter(a => a.status === 'pending' || a.status === 'carried').length;

  // 2) Versus: en cuántas semanas cada usuario completó el 100% de lo suyo.
  const byWeekAndUser = new Map(); // "weekStart|userId" -> assignments[]
  finished.forEach(a => {
    const key = a.weekStart + '|' + a.assignedToUserId;
    if (!byWeekAndUser.has(key)) byWeekAndUser.set(key, []);
    byWeekAndUser.get(key).push(a);
  });
  const perfectWeeksByUser = {};
  Object.keys(usersById).forEach(uid => { perfectWeeksByUser[uid] = 0; });
  for (const [key, list] of byWeekAndUser) {
    const userId = key.split('|')[1];
    if (list.length > 0 && list.every(a => a.status === 'done')) {
      perfectWeeksByUser[userId] = (perfectWeeksByUser[userId] || 0) + 1;
    }
  }
  const versus = Object.entries(perfectWeeksByUser).map(([userId, perfectWeeks]) => ({
    userId,
    name: usersById[userId]?.name || '(usuario eliminado)',
    perfectWeeks
  }));

  // 3) Confiabilidad por tarea: % de veces que se completó cuando le tocaba.
  const byTask = new Map(); // taskName -> { completed, total }
  finished.forEach(a => {
    const name = a.taskName || '(tarea eliminada)';
    if (!byTask.has(name)) byTask.set(name, { completed: 0, total: 0 });
    const bucket = byTask.get(name);
    bucket.total += 1;
    if (a.status === 'done') bucket.completed += 1;
  });
  const taskReliability = [...byTask.entries()]
    .map(([taskName, { completed, total }]) => ({
      taskName,
      completed,
      total,
      rate: total > 0 ? completed / total : 0
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    finishedWeeksCount: new Set(finished.map(a => a.weekStart)).size,
    overallCompletion: { completed, notCompleted },
    versus,
    taskReliability
  };
}

module.exports = { computeStats };
