// Base de datos simple basada en un archivo JSON.
// Suficiente para uso local / pocos hogares. El día de mañana esto se puede
// reemplazar por Postgres/Mongo sin tocar el resto de la app: solo hay que
// re-implementar estas mismas funciones (get/save) contra una base real.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
let DB_FILE = path.join(DATA_DIR, 'data.json');

function setDbFile(filePath) {
  DB_FILE = filePath;
}

function defaultData() {
  return {
    households: [],   // { id, name, cronDay, cronHour, createdAt }
    users: [],         // { id, householdId, name, email, passwordHash, createdAt }
    tasks: [],          // { id, householdId, name, frequencyLabel, frequencyDays, active, createdAt }
    assignments: [],    // { id, taskId, householdId, weekStart, assignedToUserId, status, completedAt, completedByUserId, createdAt }
    notifications: [],  // { id, userId, householdId, type, message, swapRequestId, read, createdAt }
    swapRequests: [],   // { id, householdId, weekStart, fromUserId, fromAssignmentId, fromTaskName,
                         //   toUserId, toAssignmentId, toTaskName, requestMessage, responseMessage,
                         //   status: pending|accepted|denied, createdAt, respondedAt }
    passwordResets: []  // { id, userId, token, expiresAt, used, createdAt }
  };
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Ejecuta fn(data) y persiste el resultado. Simple pero evita duplicar
// código de load/save en cada lugar que necesita escribir.
function transaction(fn) {
  const data = load();
  const result = fn(data);
  save(data);
  return result;
}

module.exports = { load, save, transaction, DB_FILE, setDbFile };
