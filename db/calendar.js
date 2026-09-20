// Helpers puros de calendario compartido.
//
// Las fechas se manejan SIEMPRE como strings 'YYYY-MM-DD': la comparación
// lexicográfica es segura (cero-padding) y evita la clase de bugs de
// timezone que el repo ya corrigió en db/rotation.js y server.js. "Hoy" y
// los límites del mes los resuelve el servidor con getDateInTimezone
// (TIMEZONE env) — nunca el cliente con new Date().toISOString().

// Devuelve el rango inclusivo [start, end] de un mes 'YYYY-MM' como strings
// 'YYYY-MM-DD'. Devuelve null si el mes no tiene formato o valores válidos
// (2026-13 y 2026-9 no son meses reales).
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) return null;
  const year = Number(m[1]);
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) return null;

  const start = month + '-01';
  // Día 0 del mes siguiente == último día del mes pedido (maneja bisiestos).
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const end = month + '-' + String(lastDay).padStart(2, '0');
  return { start, end };
}

// Devuelve si un evento (startDate..endDate inclusivo) toca el rango
// [start, end]. Comparación lexicográfica de strings 'YYYY-MM-DD'.
function monthOverlap(ev, start, end) {
  return ev.startDate <= end && ev.endDate >= start;
}

module.exports = { monthRange, monthOverlap };