// Elimina todas las asignaciones, intercambios y notificaciones
// de la semana en curso, para arrancar fresh el próximo domingo.
// Uso: node scripts/clean-current-week.js
// Ejecutar desde /app en Fly.io: node scripts/clean-current-week.js

const { load, save } = require('../db/jsondb');

function currentWeekStart() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

const data = load();
const weekStr = currentWeekStart();

console.log(`Semana actual: ${weekStr}`);

const hIds = new Set(data.households.map(h => h.id));

let removedAssignments = 0;
let removedSwaps = 0;
let removedNotifs = 0;

// 1. IDs de swap requests de la semana actual
const currentSwapIds = new Set(
  data.swapRequests.filter(s => s.weekStart === weekStr).map(s => s.id)
);

// 2. Remover asignaciones de la semana actual
const beforeAssignments = data.assignments.length;
data.assignments = data.assignments.filter(a => {
  if (a.weekStart === weekStr) { removedAssignments++; return false; }
  return true;
});

// 3. Remover swap requests de la semana actual
const beforeSwaps = data.swapRequests.length;
data.swapRequests = data.swapRequests.filter(s => {
  if (s.weekStart === weekStr) { removedSwaps++; return false; }
  return true;
});

// 4. Remover notificaciones vinculadas a esos swaps
const beforeNotifs = data.notifications.length;
data.notifications = data.notifications.filter(n => {
  if (n.swapRequestId && currentSwapIds.has(n.swapRequestId)) { removedNotifs++; return false; }
  return true;
});

save(data);

console.log(`Eliminadas ${removedAssignments} asignaciones, ${removedSwaps} intercambios, ${removedNotifs} notificaciones.`);
console.log('Listo. El domingo a las 8am el cron genera las nuevas tareas.');
