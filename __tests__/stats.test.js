const { computeStats } = require('../db/stats');

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

describe('computeStats', () => {
  const currentWeek = '2024-01-14';

  it('should return zeros for empty data', () => {
    const data = makeData();
    const stats = computeStats(data, 'h1', currentWeek);
    expect(stats.finishedWeeksCount).toBe(0);
    expect(stats.overallCompletion.completed).toBe(0);
    expect(stats.overallCompletion.notCompleted).toBe(0);
    expect(stats.versus).toEqual([]);
    expect(stats.taskReliability).toEqual([]);
  });

  it('should only count finished weeks (before current week)', () => {
    const data = makeData({
      users: [{ id: 'u1', householdId: 'h1', name: 'Alice' }],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Task 1' },
        { id: 'a2', householdId: 'h1', weekStart: '2024-01-14', assignedToUserId: 'u1', status: 'pending', taskName: 'Task 2' },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    expect(stats.finishedWeeksCount).toBe(1);
    expect(stats.overallCompletion.completed).toBe(1);
    expect(stats.overallCompletion.notCompleted).toBe(0);
  });

  it('should calculate overall completion correctly', () => {
    const data = makeData({
      users: [{ id: 'u1', householdId: 'h1', name: 'Alice' }],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Task 1' },
        { id: 'a2', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'pending', taskName: 'Task 2' },
        { id: 'a3', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'carried', taskName: 'Task 3' },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    expect(stats.overallCompletion.completed).toBe(1);
    expect(stats.overallCompletion.notCompleted).toBe(2);
  });

  it('should calculate perfect weeks per user', () => {
    const data = makeData({
      users: [
        { id: 'u1', householdId: 'h1', name: 'Alice' },
        { id: 'u2', householdId: 'h1', name: 'Bob' },
      ],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Task 1' },
        { id: 'a2', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u2', status: 'done', taskName: 'Task 2' },
        { id: 'a3', householdId: 'h1', weekStart: '2023-12-31', assignedToUserId: 'u1', status: 'done', taskName: 'Task 3' },
        { id: 'a4', householdId: 'h1', weekStart: '2023-12-31', assignedToUserId: 'u2', status: 'pending', taskName: 'Task 4' },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    const alice = stats.versus.find(v => v.name === 'Alice');
    const bob = stats.versus.find(v => v.name === 'Bob');
    expect(alice.perfectWeeks).toBe(2);
    expect(bob.perfectWeeks).toBe(1);
  });

  it('should calculate task reliability sorted by rate', () => {
    const data = makeData({
      users: [{ id: 'u1', householdId: 'h1', name: 'Alice' }],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Always Done' },
        { id: 'a2', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Always Done' },
        { id: 'a3', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Half Done' },
        { id: 'a4', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'pending', taskName: 'Half Done' },
        { id: 'a5', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'pending', taskName: 'Never Done' },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    expect(stats.taskReliability[0].taskName).toBe('Always Done');
    expect(stats.taskReliability[0].rate).toBe(1);
    expect(stats.taskReliability[1].taskName).toBe('Half Done');
    expect(stats.taskReliability[1].rate).toBe(0.5);
    expect(stats.taskReliability[2].taskName).toBe('Never Done');
    expect(stats.taskReliability[2].rate).toBe(0);
  });

  it('should handle missing user names', () => {
    const data = makeData({
      users: [{ id: 'u1', householdId: 'h1', name: 'Alice' }],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: 'Task 1' },
        { id: 'a2', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u2', status: 'done', taskName: 'Task 2' },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    const missing = stats.versus.find(v => v.name === '(usuario eliminado)');
    expect(missing).toBeDefined();
  });

  it('should handle deleted task names', () => {
    const data = makeData({
      users: [{ id: 'u1', householdId: 'h1', name: 'Alice' }],
      assignments: [
        { id: 'a1', householdId: 'h1', weekStart: '2024-01-07', assignedToUserId: 'u1', status: 'done', taskName: null },
      ]
    });
    const stats = computeStats(data, 'h1', '2024-01-14');
    expect(stats.taskReliability).toHaveLength(1);
    expect(stats.taskReliability[0].taskName).toBe('(tarea eliminada)');
  });
});
