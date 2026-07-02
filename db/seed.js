// Ejecutar con: npm run seed
// Crea (si no existe) el hogar "Casa" con los usuarios Delfina y Martín,
// y carga la lista de tareas tal como estaba en Limpieza.xlsx.
// Es seguro correrlo de nuevo: si el hogar ya existe, no lo duplica.

const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { load, save } = require('./jsondb');
const { normalizeFrequencyLabel, daysForLabel } = require('./frequencies');

// Tareas tal como figuran en Limpieza.xlsx (columna Tarea + Frecuencia).
// Se excluye "chimenea / asador" (frecuencia "al uso") por pedido explícito:
// no tiene una periodicidad fija, así que no entra en la rotación automática.
const RAW_TASKS = [
  ['Baños', 'Semanal'],
  ['Cocina', 'Semanal'],
  ['Mopa', 'Semanal'],
  ['Plumero / trapo por la casa', 'Semanal'],
  ['Horno', 'Semestral'],
  ['Terraza', 'Semanal'],
  ['Jardín', 'Quincenal'],
  ['Cristales', 'Bimensual'],
  ['Estacionamiento', 'Semanal'],
  ['Sótano', 'Semanal'],
  ['Escaleras', 'Semanal'],
  ['Tachos de basura', 'Semanal'],
  ['Persianas', 'Semestral'],
  ['Heladera', 'Semestral'],
  ['Cajones / estantes por dentro cocina', 'Semestral'],
  ['Regar plantas interior', 'Quincenal'],
  ['Plantas exterior', 'Semanal'],
  ['Lavar cojines y funda sofá', 'Trimestral'],
  ['Cambiar toallas de baño', 'Cada 2 semanas'],
  ['Cambiar sábanas', 'Semanal'],
  ['Lavar alfombras (baño, habitación)', 'Cada 2 semanas'],
  ['Limpiar a Marcelo', 'Quincenal'],
  ['Cambiar trapos de cocina', 'Cada 2 semanas']
];

function seed() {
  const data = load();

  let household = data.households.find(h => h.name === 'Cueva');
  if (!household) {
    household = {
      id: randomUUID(),
      name: 'Cueva',
      cronDay: 0,        // 0 = domingo
      cronHour: 8,        // 8:00 hs
      createdAt: new Date().toISOString()
    };
    data.households.push(household);
    console.log('Hogar creado:', household.name);
  } else {
    console.log('El hogar "Cueva" ya existía, no se duplica.');
  }

  const defaultPassword = 'cambiar123'; // cambiar el password real desde la app
  const hash = bcrypt.hashSync(defaultPassword, 10);

  [['Delfina', 'delfina'], ['Martín', 'martin']].forEach(([name, username]) => {
    const exists = data.users.find(u => u.householdId === household.id && u.name === name);
    if (!exists) {
      data.users.push({
        id: randomUUID(),
        householdId: household.id,
        name,
        username,
        passwordHash: hash,
        avatar: null,
        recoveryEmail: '',
        createdAt: new Date().toISOString()
      });
      console.log(`Usuario creado: ${name} (usuario: ${username} / password inicial: ${defaultPassword})`);
    }
  });

  RAW_TASKS.forEach(([name, freqRaw]) => {
    const exists = data.tasks.find(t => t.householdId === household.id && t.name === name);
    if (exists) return;
    const label = normalizeFrequencyLabel(freqRaw);
    if (!label) {
      console.warn(`Frecuencia no reconocida para "${name}": "${freqRaw}", se omite.`);
      return;
    }
    data.tasks.push({
      id: randomUUID(),
      householdId: household.id,
      name,
      description: '',
      frequencyLabel: label,
      frequencyDays: daysForLabel(label),
      active: true,
      createdAt: new Date().toISOString()
    });
  });

  save(data);
  console.log(`Listo. ${data.tasks.filter(t => t.householdId === household.id).length} tareas cargadas.`);
}

seed();
