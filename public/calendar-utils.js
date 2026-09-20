// Helpers puros del frontend de calendario (UMD: corren en el browser vía
// <script> y en node vía require para los tests).
//
// Las fechas se manejan SIEMPRE como strings 'YYYY-MM' / 'YYYY-MM-DD': la
// comparación lexicográfica es segura (cero-padding) y evita la clase de bugs
// de timezone que el repo ya corrigió en db/rotation.js. "Hoy" lo resuelve el
// servidor con getDateInTimezone (TIMEZONE env) — el cliente nunca usa
// new Date().toISOString() para fechas de calendario.

// Labels de los días de la semana en español, lunes primero (convención de
// Argentina, igual que los inputs type="date" del browser).
const WEEKDAY_LABELS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Desplaza un mes 'YYYY-MM' en delta meses (negativo = anterior) con
// aritmética de meses, no de días: '2026-01' - 1 = '2025-12'. Devuelve null si
// el mes no es un 'YYYY-MM' válido.
function shiftMonth(month, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return null;
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) return null;
  const total = Number(m[1]) * 12 + (monthNum - 1) + delta;
  const year = Math.floor(total / 12);
  const resultMonth = (total % 12) + 1; // 1-12
  return year + '-' + String(resultMonth).padStart(2, '0');
}

// Cantidad de días de un mes 'YYYY-MM'. Día 0 del mes siguiente == último día
// del mes pedido (maneja bisiestos). Devuelve null si el mes no es válido.
function monthDays(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return null;
  const year = Number(m[1]);
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) return null;
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

// Grid de 6 semanas x 7 columnas (lunes primero) para un mes 'YYYY-MM'.
// Devuelve siempre 42 celdas { date: 'YYYY-MM-DD' | null, day: number | null }
// (las celdas vacías de relleno llevan date null). Vacío si el mes no es
// válido.
function calendarMonthGrid(month) {
  const days = monthDays(month);
  if (!days) return [];
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  // JS: getUTCDay() devuelve 0=domingo..6=sábado; lo convertimos a lunes=0.
  const leading = (new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < leading; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= days; d++) {
    cells.push({ date: month + '-' + String(d).padStart(2, '0'), day: d });
  }
  while (cells.length < 42) cells.push({ date: null, day: null });
  return cells;
}

// Soporte UMD: en el browser quedan como funciones globales (app.js las usa
// directo); en node se exportan para los tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shiftMonth, monthDays, calendarMonthGrid, WEEKDAY_LABELS_ES };
}