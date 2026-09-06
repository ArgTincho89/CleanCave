const { addDays, todayStr, weekStartFor, lastCompletion, setManualCompletion, generateWeek, isPinned } = require('../db/rotation');

function makeData(overrides = {}) {
  return {
    households: [],
    users: [],
    tasks: [],
    assignments: [],
    notifications: [],
    swapRequests: [],
    passwordResets: [],
    ...overrides
  };
}

describe('rotation', () => {
  describe('todayStr', () => {
    const { todayStr } = require('../db/rotation');

    it('should return today date in YYYY-MM-DD format', () => {
      const result = todayStr();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const expected = new Date().toISOString().slice(0, 10);
      expect(result).toBe(expected);
    });
  });
  describe('addDays', () => {
    it('should add days to a date string', () => {
      expect(addDays('2024-06-15', 3)).toBe('2024-06-18');
      expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
      expect(addDays('2024-06-15', -1)).toBe('2024-06-14');
    });

    it('should be reversible', () => {
      const original = '2024-06-15';
      const added = addDays(original, 7);
      const back = addDays(added, -7);
      expect(back).toBe(original);
    });

    it('should handle month boundaries', () => {
      expect(addDays('2024-06-30', 1)).toBe('2024-07-01');
      expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    });
  });

  describe('weekStartFor', () => {
    it('should return the Sunday of the week containing the date', () => {
      expect(weekStartFor('2024-06-19')).toBe('2024-06-16');
      expect(weekStartFor('2024-06-16')).toBe('2024-06-16');
      expect(weekStartFor('2024-06-17')).toBe('2024-06-16');
    });
  });

  describe('lastCompletion', () => {
    it('should return the most recent completed assignment', () => {
      const data = makeData({
        assignments: [
          { id: '1', taskId: 't1', status: 'done', completedAt: '2024-01-01T12:00:00.000Z', assignedToUserId: 'u1' },
          { id: '2', taskId: 't1', status: 'done', completedAt: '2024-01-15T12:00:00.000Z', assignedToUserId: 'u2' },
          { id: '3', taskId: 't1', status: 'pending', completedAt: null },
        ]
      });
      const result = lastCompletion(data, 't1');
      expect(result.id).toBe('2');
    });

    it('should return null if no completions exist', () => {
      const data = makeData({ assignments: [] });
      expect(lastCompletion(data, 't1')).toBeNull();
    });

    it('should return null if only pending assignments exist', () => {
      const data = makeData({
        assignments: [{ id: '1', taskId: 't1', status: 'pending', completedAt: null }]
      });
      expect(lastCompletion(data, 't1')).toBeNull();
    });
  });

  describe('setManualCompletion', () => {
    it('should create a done assignment with manualEntry flag', () => {
      const data = makeData();
      const task = { id: 't1', name: 'Test task', frequencyLabel: 'Semanal' };
      const result = setManualCompletion(data, 'h1', task, 'u1', '2024-01-15');
      expect(result.status).toBe('done');
      expect(result.manualEntry).toBe(true);
      expect(result.taskId).toBe('t1');
      expect(result.assignedToUserId).toBe('u1');
      expect(result.householdId).toBe('h1');
      expect(data.assignments).toHaveLength(1);
    });
  });

  describe('generateWeek', () => {
    it('should throw if household has no members', () => {
      const data = makeData();
      expect(() => generateWeek(data, 'h1', '2024-01-07')).toThrow('El hogar no tiene integrantes todavía.');
    });

    it('should create assignments for active tasks with no history', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
          { id: 't2', householdId: 'h1', name: 'Task 2', frequencyLabel: 'Quincenal', frequencyDays: 14, active: true },
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(2);
      expect(data.assignments.filter(a => a.weekStart === '2024-01-07')).toHaveLength(2);
    });

    it('should skip inactive tasks', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: false },
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(0);
    });

    it('should not duplicate existing assignments for the same week', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
        ],
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'pending' }
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(0);
      expect(data.assignments.filter(a => a.weekStart === '2024-01-07')).toHaveLength(1);
    });

    it('should carry over pending tasks from previous weeks', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
        ],
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2023-12-31', assignedToUserId: 'u1', status: 'pending' }
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      const carried = data.assignments.filter(a => a.weekStart === '2024-01-07' && a.carriedOver);
      expect(carried).toHaveLength(1);
      expect(carried[0].assignedToUserId).toBe('u1');
      expect(data.assignments.find(a => a.id === 'a1').status).toBe('carried');
    });

    it('should handle single-member household', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Solo', createdAt: '2024-01-01' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
        ],
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2023-12-31', assignedToUserId: 'u1', status: 'done', completedAt: '2024-01-01T12:00:00.000Z', completedByUserId: 'u1' }
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(1);
      expect(created[0].assignedToUserId).toBe('u1');
    });

    it('should sort members by creation date', () => {
      const data = makeData({
        users: [
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(1);
    });

    it('should rotate assignments based on last completion', () => {
      const data = makeData({
        users: [
          { id: 'u1', householdId: 'h1', name: 'Alice', createdAt: '2024-01-01' },
          { id: 'u2', householdId: 'h1', name: 'Bob', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Task 1', frequencyLabel: 'Semanal', frequencyDays: 7, active: true },
        ],
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2023-12-31', assignedToUserId: 'u1', status: 'done', completedAt: '2024-01-01T12:00:00.000Z', completedByUserId: 'u1' }
        ]
      });
      const created = generateWeek(data, 'h1', '2024-01-07');
      expect(created).toHaveLength(1);
      expect(created[0].assignedToUserId).toBe('u2');
    });
  });

  describe('isPinned', () => {
    it('should return null when pin fields are absent', () => {
      const task = { id: 't1', pinnedToUserId: undefined, pinnedFromWeek: undefined, pinnedToWeek: undefined };
      expect(isPinned(task, '2026-08-09')).toBeNull();
    });

    it('should return null when pin fields are null', () => {
      const task = { id: 't1', pinnedToUserId: null, pinnedFromWeek: null, pinnedToWeek: null };
      expect(isPinned(task, '2026-08-09')).toBeNull();
    });

    it('should return the pinned userId when weekStart is inside the inclusive range', () => {
      const task = { id: 't1', pinnedToUserId: 'u2', pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' };
      expect(isPinned(task, '2026-08-09')).toEqual({ userId: 'u2' });
      expect(isPinned(task, '2026-08-16')).toEqual({ userId: 'u2' });
      expect(isPinned(task, '2026-08-23')).toEqual({ userId: 'u2' });
    });

    it('should return null when weekStart is before the fromWeek boundary', () => {
      const task = { id: 't1', pinnedToUserId: 'u2', pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' };
      expect(isPinned(task, '2026-08-02')).toBeNull();
    });

    it('should return null when weekStart is after the toWeek boundary', () => {
      const task = { id: 't1', pinnedToUserId: 'u2', pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' };
      expect(isPinned(task, '2026-08-30')).toBeNull();
    });
  });

  describe('generateWeek pinning', () => {
    const u1 = 'u1'; // Martín
    const u2 = 'u2'; // Delfina

    function hhWithPin(overrides = {}) {
      return makeData({
        users: [
          { id: u1, householdId: 'h1', name: 'Martín', createdAt: '2024-01-01' },
          { id: u2, householdId: 'h1', name: 'Delfina', createdAt: '2024-01-02' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Tarea', frequencyLabel: 'Semanal', frequencyDays: 7, active: true,
            pinnedToUserId: u2, pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' },
        ],
        assignments: [],
        ...overrides
      });
    }

    it('should assign the pinned user on each due week within the range', () => {
      const data = hhWithPin();
      // Simulate week-by-week: generate, then complete the pending row as the
      // pinned user, before generating the next week. Rotation alone (last
      // completer = u2) would give u1 next; the pin keeps it on u2.
      generateWeek(data, 'h1', '2026-08-09');
      data.assignments.forEach(a => {
        if (a.taskId === 't1' && a.weekStart === '2026-08-09') {
          a.status = 'done'; a.completedAt = '2026-08-10T12:00:00.000Z'; a.completedByUserId = u2;
        }
      });
      const w2 = generateWeek(data, 'h1', '2026-08-16');
      data.assignments.forEach(a => {
        if (a.taskId === 't1' && a.weekStart === '2026-08-16') {
          a.status = 'done'; a.completedAt = '2026-08-17T12:00:00.000Z'; a.completedByUserId = u2;
        }
      });
      const w3 = generateWeek(data, 'h1', '2026-08-23');
      expect(w2[0].assignedToUserId).toBe(u2);
      expect(w3[0].assignedToUserId).toBe(u2);
      // One row per generated week, all assigned to the pinned user.
      const rows = data.assignments.filter(a => a.taskId === 't1' && a.weekStart >= '2026-08-09');
      expect(rows).toHaveLength(3);
      rows.forEach(r => expect(r.assignedToUserId).toBe(u2));
    });

    it('should resume rotation for a week out of the pin range', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a0', taskId: 't1', householdId: 'h1', weekStart: '2026-08-02', assignedToUserId: u2, status: 'done', completedAt: '2026-08-03T12:00:00.000Z', completedByUserId: u2 },
        ]
      });
      const created = generateWeek(data, 'h1', '2026-08-30');
      expect(created).toHaveLength(1);
      expect(created[0].assignedToUserId).toBe(u1);
    });

    it('should honor the frequency gate: not-due pinned week produces no assignment', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a0', taskId: 't1', householdId: 'h1', weekStart: '2026-08-02', assignedToUserId: u1, status: 'done', completedAt: '2026-08-17T12:00:00.000Z', completedByUserId: u1 },
        ]
      });
      // last done 08-17, next_due 08-24; week 08-09 window end 08-15 -> not due.
      const created = generateWeek(data, 'h1', '2026-08-09');
      expect(created).toHaveLength(0);
      expect(data.assignments.filter(a => a.taskId === 't1' && a.weekStart === '2026-08-09')).toHaveLength(0);
    });

    it('should switch to the other user after the range ends', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a0', taskId: 't1', householdId: 'h1', weekStart: '2026-08-23', assignedToUserId: u2, status: 'done', completedAt: '2026-08-23T12:00:00.000Z', completedByUserId: u2 },
        ]
      });
      const created = generateWeek(data, 'h1', '2026-08-30');
      expect(created).toHaveLength(1);
      expect(created[0].assignedToUserId).toBe(u1);
    });

    it('should keep the current week assignment unchanged when the pin is removed', () => {
      const task = { id: 't1', householdId: 'h1', name: 'Tarea', frequencyLabel: 'Semanal', frequencyDays: 7, active: true };
      const data = makeData({
        users: [
          { id: u1, householdId: 'h1', name: 'Martín', createdAt: '2024-01-01' },
          { id: u2, householdId: 'h1', name: 'Delfina', createdAt: '2024-01-02' },
        ],
        tasks: [task],
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2026-08-09', assignedToUserId: u2, status: 'pending', completedAt: null },
        ]
      });
      const created = generateWeek(data, 'h1', '2026-08-09');
      expect(created).toHaveLength(0);
      const row = data.assignments.find(a => a.id === 'a1');
      expect(row.assignedToUserId).toBe(u2);
      expect(data.assignments.filter(a => a.taskId === 't1' && a.weekStart === '2026-08-09')).toHaveLength(1);
    });

    it('should reassign an overdue pending row to the pinned user (pin wins over carry-over)', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a0', taskId: 't1', householdId: 'h1', weekStart: '2026-07-26', assignedToUserId: u1, status: 'pending', completedAt: null },
        ]
      });
      const created = generateWeek(data, 'h1', '2026-08-09');
      expect(created).toHaveLength(0);
      // old overdue row marked carried
      expect(data.assignments.find(a => a.id === 'a0').status).toBe('carried');
      // single current-week row reassigned to pinned user
      const rows = data.assignments.filter(a => a.taskId === 't1' && a.weekStart === '2026-08-09');
      expect(rows).toHaveLength(1);
      expect(rows[0].assignedToUserId).toBe(u2);
      expect(rows[0].carriedOver).toBe(true);
    });

    it('should keep a done row immutable under pin regeneration', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2026-08-09', assignedToUserId: u1, status: 'done', completedAt: '2026-08-09T12:00:00.000Z', completedByUserId: u1 },
        ]
      });
      const created = generateWeek(data, 'h1', '2026-08-09');
      expect(created).toHaveLength(0);
      const row = data.assignments.find(a => a.id === 'a1');
      expect(row.status).toBe('done');
      expect(row.assignedToUserId).toBe(u1);
      expect(data.assignments.filter(a => a.taskId === 't1' && a.weekStart === '2026-08-09')).toHaveLength(1);
    });

    it('should be a no-op (normal assignment) for a 1-member household', () => {
      const data = makeData({
        users: [
          { id: u1, householdId: 'h1', name: 'Solo', createdAt: '2024-01-01' },
        ],
        tasks: [
          { id: 't1', householdId: 'h1', name: 'Tarea', frequencyLabel: 'Semanal', frequencyDays: 7, active: true,
            pinnedToUserId: u1, pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' },
        ],
        assignments: []
      });
      const created = generateWeek(data, 'h1', '2026-08-09');
      expect(created).toHaveLength(1);
      expect(created[0].assignedToUserId).toBe(u1);
    });

    it('should pause a deactivated pinned task and resume on reactivation', () => {
      const task = { id: 't1', householdId: 'h1', name: 'Tarea', frequencyLabel: 'Semanal', frequencyDays: 7, active: false,
        pinnedToUserId: u2, pinnedFromWeek: '2026-08-09', pinnedToWeek: '2026-08-23' };
      const data = makeData({
        users: [
          { id: u1, householdId: 'h1', name: 'Martín', createdAt: '2024-01-01' },
          { id: u2, householdId: 'h1', name: 'Delfina', createdAt: '2024-01-02' },
        ],
        tasks: [task],
        assignments: []
      });
      const deactivated = generateWeek(data, 'h1', '2026-08-09');
      expect(deactivated).toHaveLength(0);
      task.active = true;
      const reactivated = generateWeek(data, 'h1', '2026-08-09');
      expect(reactivated).toHaveLength(1);
      expect(reactivated[0].assignedToUserId).toBe(u2);
    });

    it('should not duplicate assignments on idempotent regeneration', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'a1', taskId: 't1', householdId: 'h1', weekStart: '2026-08-09', assignedToUserId: u2, status: 'pending', completedAt: null },
        ]
      });
      generateWeek(data, 'h1', '2026-08-09');
      generateWeek(data, 'h1', '2026-08-09');
      expect(data.assignments.filter(a => a.taskId === 't1' && a.weekStart === '2026-08-09')).toHaveLength(1);
    });

    it('should leave past weeks untouched when a pinned week is generated', () => {
      const data = hhWithPin({
        assignments: [
          { id: 'p1', taskId: 't1', householdId: 'h1', weekStart: '2026-07-05', assignedToUserId: u1, status: 'done', completedAt: '2026-07-06T12:00:00.000Z', completedByUserId: u1 },
          { id: 'p2', taskId: 't1', householdId: 'h1', weekStart: '2026-07-12', assignedToUserId: u2, status: 'done', completedAt: '2026-07-13T12:00:00.000Z', completedByUserId: u2 },
        ]
      });
      generateWeek(data, 'h1', '2026-08-09');
      const past = data.assignments.filter(a => a.id === 'p1' || a.id === 'p2');
      expect(past).toHaveLength(2);
      expect(past[0].assignedToUserId).toBe(u1);
      expect(past[0].status).toBe('done');
      expect(past[1].assignedToUserId).toBe(u2);
      expect(past[1].status).toBe('done');
    });
  });
});
