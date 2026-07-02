// Frecuencias predefinidas (label visible -> cantidad de días del ciclo).
// "Personalizado" permite que el usuario cargue cualquier cantidad de días.
const FREQUENCIES = {
  'Semanal': 7,
  'Quincenal': 14,
  'Mensual': 30,
  'Bimensual': 60,
  'Trimestral': 90,
  'Semestral': 182,
  'Anual': 365
};

// Normaliza variantes de texto que puedan venir de una planilla vieja
// (errores de tipeo, mayúsculas distintas, etc.) a una de las etiquetas de arriba.
function normalizeFrequencyLabel(label) {
  const clean = (label || '').trim().toLowerCase();
  const map = {
    'semanal': 'Semanal',
    'quincenal': 'Quincenal',
    'cada 2 semanas': 'Quincenal',
    'cada 2 seamanas': 'Quincenal', // typo visto en la planilla original
    'mensual': 'Mensual',
    'bimensual': 'Bimensual',
    'trimestral': 'Trimestral',
    'semestral': 'Semestral',
    'anual': 'Anual'
  };
  return map[clean] || null;
}

function daysForLabel(label) {
  return FREQUENCIES[label] || null;
}

module.exports = { FREQUENCIES, normalizeFrequencyLabel, daysForLabel };
