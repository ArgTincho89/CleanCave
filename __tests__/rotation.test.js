const { addDays, todayStr, weekStartFor, lastCompletion, setManualCompletion, generateWeek } = require('../db/rotation');

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
});
