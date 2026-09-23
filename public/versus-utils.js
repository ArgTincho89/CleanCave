// Helpers puros del frontend de versus (UMD: corren en el browser vía
// <script> y en node vía require para los tests). Patrón: calendar-utils.js.

// Escapa los 5 caracteres HTML que pueden romper el render de una card.
// Espejo byte-idéntico de escapeHtml() de app.js (sección calendario,
// ~línea 1576), a propósito: versus mantiene SU copia en este módulo para
// que RF-07 (el texto ajeno se muestre como texto literal inerte y nunca
// genere elementos) sea testeable con jest sin harness de frontend. Si se
// toca el mapa acá, tocarlo también en app.js — y viceversa.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Una card es "nueva" (pill de novedad, D8) cuando su createdAt tiene menos
// de 48 h de antigüedad según el reloj del cliente. nowMs lo pasa el render
// para que el límite sea testeable (47,9 h → true; 49 h → false).
const VS_NEW_CARD_WINDOW_MS = 48 * 60 * 60 * 1000;

function vsIsNewCard(card, nowMs) {
  const ageMs = nowMs - Date.parse(card.createdAt);
  return ageMs >= 0 && ageMs < VS_NEW_CARD_WINDOW_MS;
}

// Soporte UMD: en el browser quedan como funciones globales (app.js las usa
// directo); en node se exportan para los tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml, vsIsNewCard };
}