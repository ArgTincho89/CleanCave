const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';

const { setDbFile } = require('../db/jsondb');

const TEST_DB = path.join(__dirname, 'test-data.json');

beforeEach(() => {
  setDbFile(TEST_DB);
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

afterAll(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

const { app } = require('../server');
const request = require('supertest');
const { addDays } = require('../db/rotation');

function createHousehold(agent) {
  return agent
    .post('/api/auth/register-household')
    .send({
      householdName: 'Test Home',
      members: [
        { name: 'Alice', username: 'alice', password: 'pass123' },
        { name: 'Bob', username: 'bob', password: 'pass456' }
      ]
    });
}

describe('API', () => {
  describe('Auth', () => {
    it('POST /api/auth/register-household should create household and users', async () => {
      const agent = request.agent(app);
      const res = await createHousehold(agent);
      expect(res.status).toBe(200);
      expect(res.body.household.name).toBe('Test Home');
      expect(res.body.user.name).toBe('Alice');
    });

    it('POST /api/auth/register-household should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register-household')
        .send({ householdName: 'Bad' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Falta');
    });

    it('POST /api/auth/login should authenticate valid users', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await agent
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'pass123' });
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Alice');
    });

    it('POST /api/auth/login should reject wrong password', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await agent
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'wrong' });
      expect(res.status).toBe(401);
    });

    it('POST /api/auth/login should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'pass123' });
      expect(res.status).toBe(401);
    });

    it('POST /api/auth/logout should destroy session', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      await agent.post('/api/auth/logout');
      const res = await agent.get('/api/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Me (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('GET /api/me should return user profile', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/me');
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe('Alice');
      expect(res.body.household.name).toBe('Test Home');
      expect(res.body.members).toHaveLength(2);
    });

    it('GET /api/me should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });

    it('POST /api/me/password should change password', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/me/password')
        .send({ currentPassword: 'pass123', newPassword: 'newpass123' });
      expect(res.status).toBe(200);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'newpass123' });
      expect(loginRes.status).toBe(200);
    });

    it('POST /api/me/password should reject wrong current password', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/me/password')
        .send({ currentPassword: 'wrong', newPassword: 'newpass123' });
      expect(res.status).toBe(400);
    });

    it('POST /api/me/password should reject short passwords', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/me/password')
        .send({ currentPassword: 'pass123', newPassword: 'ab' });
      expect(res.status).toBe(400);
    });

    it('PUT /api/me/recovery-email should save email', async () => {
      const agent = await authedAgent();
      const res = await agent
        .put('/api/me/recovery-email')
        .send({ email: 'alice@test.com' });
      expect(res.status).toBe(200);
      expect(res.body.user.recoveryEmail).toBe('alice@test.com');
    });

    it('PUT /api/me/avatar should save avatar data URL', async () => {
      const agent = await authedAgent();
      const res = await agent
        .put('/api/me/avatar')
        .send({ avatarDataUrl: 'data:image/png;base64,fake' });
      expect(res.status).toBe(200);
      expect(res.body.user.avatar).toBe('data:image/png;base64,fake');
    });

    it('PUT /api/me/avatar should reject large images', async () => {
      const agent = await authedAgent();
      const big = 'data:image/png;base64,' + 'a'.repeat(2_000_000);
      const res = await agent
        .put('/api/me/avatar')
        .send({ avatarDataUrl: big });
      expect(res.status).toBe(400);
    });
  });

  describe('Tasks (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('POST /api/tasks should create a task', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/tasks')
        .send({ name: 'Clean kitchen', frequencyLabel: 'Semanal' });
      expect(res.status).toBe(200);
      expect(res.body.task.name).toBe('Clean kitchen');
    });

    it('POST /api/tasks should create a task with custom frequency', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/tasks')
        .send({ name: 'Custom task', frequencyLabel: 'Personalizado', customDays: '10' });
      expect(res.status).toBe(200);
      expect(res.body.task.frequencyDays).toBe(10);
    });

    it('POST /api/tasks should reject invalid custom days', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/tasks')
        .send({ name: 'Bad custom', frequencyLabel: 'Personalizado', customDays: '0' });
      expect(res.status).toBe(400);
    });

    it('POST /api/tasks should reject missing name', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/tasks')
        .send({ frequencyLabel: 'Semanal' });
      expect(res.status).toBe(400);
    });

    it('POST /api/tasks should reject missing frequency', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/tasks')
        .send({ name: 'Test' });
      expect(res.status).toBe(400);
    });

    it('GET /api/tasks should list tasks', async () => {
      const agent = await authedAgent();
      await agent.post('/api/tasks').send({ name: 'Task A', frequencyLabel: 'Semanal' });
      await agent.post('/api/tasks').send({ name: 'Task B', frequencyLabel: 'Quincenal' });
      const res = await agent.get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.frequencies).toBeDefined();
    });

    it('PUT /api/tasks/:id should update a task', async () => {
      const agent = await authedAgent();
      const created = await agent
        .post('/api/tasks')
        .send({ name: 'Old name', frequencyLabel: 'Semanal' });
      const taskId = created.body.task.id;

      const res = await agent
        .put('/api/tasks/' + taskId)
        .send({ name: 'New name', description: 'Updated desc' });
      expect(res.status).toBe(200);
      expect(res.body.task.name).toBe('New name');
      expect(res.body.task.description).toBe('Updated desc');
    });

    it('PUT /api/tasks/:id should return 404 for non-existent task', async () => {
      const agent = await authedAgent();
      const res = await agent
        .put('/api/tasks/nonexistent')
        .send({ name: 'Test' });
      expect(res.status).toBe(404);
    });

    it('POST /api/tasks/:id/toggle-active should toggle task active state', async () => {
      const agent = await authedAgent();
      const created = await agent
        .post('/api/tasks')
        .send({ name: 'Toggle me', frequencyLabel: 'Semanal' });
      const taskId = created.body.task.id;

      const res = await agent.post('/api/tasks/' + taskId + '/toggle-active');
      expect(res.status).toBe(200);
      expect(res.body.task.active).toBe(false);

      const res2 = await agent.post('/api/tasks/' + taskId + '/toggle-active');
      expect(res2.body.task.active).toBe(true);
    });

    it('DELETE /api/tasks/:id should delete a task', async () => {
      const agent = await authedAgent();
      const created = await agent
        .post('/api/tasks')
        .send({ name: 'Delete me', frequencyLabel: 'Semanal' });
      const taskId = created.body.task.id;

      const res = await agent.delete('/api/tasks/' + taskId);
      expect(res.status).toBe(200);

      const list = await agent.get('/api/tasks');
      expect(list.body.tasks).toHaveLength(0);
    });

    it('DELETE /api/tasks/:id should return 404 for non-existent task', async () => {
      const agent = await authedAgent();
      const res = await agent.delete('/api/tasks/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Assignments (authenticated)', () => {
    function authedAgentWithTask() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Vacuum', frequencyLabel: 'Semanal' }))
        .then(() => agent);
    }

    it('GET /api/assignments should generate and return current week', async () => {
      const agent = await authedAgentWithTask();
      const res = await agent.get('/api/assignments');
      expect(res.status).toBe(200);
      expect(res.body.weekStart).toBeDefined();
      expect(res.body.byUser).toBeDefined();
      expect(res.body.currentUserId).toBeDefined();
    });

    it('POST /api/assignments/generate should generate assignments', async () => {
      const agent = await authedAgentWithTask();
      const res = await agent.post('/api/assignments/generate');
      expect(res.status).toBe(200);
      expect(res.body.weekStart).toBeDefined();
    });

    it('GET /api/assignments should auto-generate when frontend requests a future week (timezone mismatch)', async () => {
      // Simula el caso donde el frontend (en Madrid, UTC+2) ya está en domingo
      // a las 08:00+ pero el servidor (configurado en ART, UTC-3) todavía está
      // en sábado por la noche. El frontend pide la semana NUEVA y el servidor
      // debe generarla aunque su currentWeekStart() devuelva la semana anterior.
      const agent = await authedAgentWithTask();

      // Calculamos el domingo que sigue al currentWeekStart() del servidor
      // para simular lo que mandaría un frontend en una zona horaria adelantada.
      const currentRes = await agent.get('/api/assignments');
      const currentWeek = currentRes.body.weekStart;
      const nextSunday = addDays(currentWeek, 7);

      // Pedir la semana "futura" (desde la perspectiva del servidor)
      const res = await agent.get('/api/assignments?weekStart=' + nextSunday);
      expect(res.status).toBe(200);
      expect(res.body.weekStart).toBe(nextSunday);

      // Debe haber tareas generadas, no lista vacía
      const allTasks = Object.values(res.body.byUser).flatMap(u => u.tasks);
      expect(allTasks.length).toBeGreaterThan(0);
      allTasks.forEach(t => {
        expect(t.weekStart).toBe(nextSunday);
        expect(t.status).toBe('pending');
      });
    });

    it('GET /api/assignments should NOT auto-generate for a past week', async () => {
      // Pedir una semana pasada no debe disparar generación.
      const agent = await authedAgentWithTask();
      const res = await agent.get('/api/assignments?weekStart=2020-01-05');
      expect(res.status).toBe(200);
      // No hay tareas para esa semana porque nunca se generó (y no se debe generar ahora)
      const allTasks = Object.values(res.body.byUser).flatMap(u => u.tasks);
      expect(allTasks.length).toBe(0);
    });
  });

  describe('Swaps (authenticated)', () => {
    function setupWithAssignments() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Task A', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/tasks').send({ name: 'Task B', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/assignments/generate'))
        .then(() => agent);
    }

    it('POST /api/swaps should create swap request', async () => {
      const agent = await setupWithAssignments();
      const week = await agent.get('/api/assignments');
      const all = week.body.all;
      const myTask = all.find(a => a.assignedToUserId === week.body.currentUserId);
      const partnerTask = all.find(a => a.assignedToUserId !== week.body.currentUserId);

      const res = await agent
        .post('/api/swaps')
        .send({ fromAssignmentId: myTask.id, toAssignmentId: partnerTask.id, message: 'Please!' });
      expect(res.status).toBe(200);
      expect(res.body.swap.status).toBe('pending');
    });

    it('POST /api/swaps should reject non-existent target', async () => {
      const agent = await setupWithAssignments();
      const week = await agent.get('/api/assignments');
      const all = week.body.all;
      const myTask = all.find(a => a.assignedToUserId === week.body.currentUserId);

      const res = await agent
        .post('/api/swaps')
        .send({ fromAssignmentId: myTask.id, toAssignmentId: 'nonexistent' });
      expect(res.status).toBe(404);
    });

    it('POST /api/swaps should reject missing assignment IDs', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await agent.post('/api/swaps').send({ fromAssignmentId: 'a', message: 'hi' });
      expect(res.status).toBe(400);
    });

    it('GET /api/swaps should list swap requests', async () => {
      const agent = await setupWithAssignments();
      const res = await agent.get('/api/swaps');
      expect(res.status).toBe(200);
      expect(res.body.swaps).toBeDefined();
    });
  });

  describe('Week proposals (authenticated)', () => {
    // Crea el hogar con Alice/Bob, una tarea y la semana generada. Devuelve
    // un agente autenticado como Alice.
    function aliceAgentWithWeek() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Vacuum', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/assignments/generate'))
        .then(() => agent);
    }

    // En loguea como Bob dentro del mismo hogar (mismo TEST_DB).
    async function bobAgent() {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      return agent;
    }

    function weekOf(agent) {
      return agent.get('/api/assignments').then(r => r.body);
    }

    it('POST /api/week-proposals should create a proposal and notify the partner', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      // Tomamos una tarea pendiente asignada a Alice y la reasignamos a Bob.
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const res = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });
      expect(res.status).toBe(200);
      expect(res.body.proposal.status).toBe('pending');
      expect(res.body.proposal.changes).toHaveLength(1);
      expect(res.body.proposal.changes[0].toUserId).toBe(bobId);

      // Bob recibe una notificación de tipo week_proposal.
      const bob = await bobAgent();
      const notifs = await bob.get('/api/notifications');
      const wp = notifs.body.notifications.find(n => n.type === 'week_proposal');
      expect(wp).toBeDefined();
      expect(wp.weekProposalId).toBe(res.body.proposal.id);
    });

    it('POST /api/week-proposals should reject a non-existent assignment', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);
      const res = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: 'nope', toUserId: bobId }] });
      expect(res.status).toBe(400);
    });

    it('POST /api/week-proposals should reject a toUser that is not a member', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const res = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: 'stranger' }] });
      expect(res.status).toBe(400);
    });

    it('POST /api/week-proposals should reject a completed assignment', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);
      const assignment = week.all.find(a => a.status === 'pending');
      await alice.post(`/api/assignments/${assignment.id}/complete`);

      const res = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('completada');
    });

    it('POST /api/week-proposals should reject a second pending proposal for the same week', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);
      await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const res = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('pendiente');
    });

    it('POST /api/week-proposals/:id/respond should apply only when all accept', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const created = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });
      const proposalId = created.body.proposal.id;

      // Bob acepta: todavía falta que el hogar complete (Alice no puede
      // responder a su propia propuesta, y es el único otro miembro).
      const bob = await bobAgent();
      const resp = await bob.post(`/api/week-proposals/${proposalId}/respond`).send({ decision: 'accept' });
      expect(resp.status).toBe(200);

      // Con 2 miembros, Bob es el único que responde (Alice propuso), así que
      // el consenso se completa y se aplica.
      expect(resp.body.proposal.status).toBe('accepted');

      // La asignación ahora está a nombre de Bob.
      const updated = await alice.get('/api/assignments?weekStart=' + week.weekStart);
      const updatedAssignment = updated.body.all.find(a => a.id === assignment.id);
      expect(updatedAssignment.assignedToUserId).toBe(bobId);
    });

    it('POST /api/week-proposals/:id/respond with deny discards and leaves week unchanged', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const created = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const bob = await bobAgent();
      const resp = await bob.post(`/api/week-proposals/${created.body.proposal.id}/respond`).send({ decision: 'deny' });
      expect(resp.status).toBe(200);
      expect(resp.body.proposal.status).toBe('denied');

      // La asignación queda como estaba (seguía a nombre de quien la tenía).
      const updated = await alice.get('/api/assignments?weekStart=' + week.weekStart);
      const updatedAssignment = updated.body.all.find(a => a.id === assignment.id);
      expect(updatedAssignment.assignedToUserId).toBe(assignment.assignedToUserId);
    });

    it('POST /api/week-proposals/:id/respond should reject own proposal', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const created = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const res = await alice.post(`/api/week-proposals/${created.body.proposal.id}/respond`).send({ decision: 'accept' });
      expect(res.status).toBe(403);
    });

    it('POST /api/week-proposals/:id/respond should reject double response', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const created = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const bob = await bobAgent();
      await bob.post(`/api/week-proposals/${created.body.proposal.id}/respond`).send({ decision: 'accept' });
      // La propuesta ya se cerró (consenso completo), responder de nuevo falla.
      const res = await bob.post(`/api/week-proposals/${created.body.proposal.id}/respond`).send({ decision: 'deny' });
      expect(res.status).toBe(400);
    });

    it('POST /api/week-proposals/:id/respond should notify the result to everyone', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);

      const created = await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const bob = await bobAgent();
      await bob.post(`/api/week-proposals/${created.body.proposal.id}/respond`).send({ decision: 'accept' });

      // Bob (que respondió) y Alice (que propuso) reciben la notificación de resultado.
      const bobNotifs = await bob.get('/api/notifications');
      expect(bobNotifs.body.notifications.some(n => n.type === 'week_proposal_result')).toBe(true);

      const aliceNotifs = await alice.get('/api/notifications');
      expect(aliceNotifs.body.notifications.some(n => n.type === 'week_proposal_result')).toBe(true);
    });

    it('GET /api/week-proposals should list proposals', async () => {
      const alice = await aliceAgentWithWeek();
      const week = await weekOf(alice);
      const assignment = week.all.find(a => a.status === 'pending');
      const bobId = Object.keys(week.byUser).find(id => id !== week.currentUserId);
      await alice
        .post('/api/week-proposals')
        .send({ weekStart: week.weekStart, changes: [{ assignmentId: assignment.id, toUserId: bobId }] });

      const res = await alice.get('/api/week-proposals');
      expect(res.status).toBe(200);
      expect(res.body.proposals).toHaveLength(1);
    });
  });

  describe('Notifications (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('GET /api/notifications should return notifications list', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/notifications');
      expect(res.status).toBe(200);
      expect(res.body.notifications).toBeDefined();
    });
  });

  describe('Weeks / History (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('GET /api/weeks should return week list', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/weeks');
      expect(res.status).toBe(200);
      expect(res.body.weeks).toBeDefined();
    });

    it('GET /api/history should return 400 without weekStart', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/history');
      expect(res.status).toBe(400);
    });
  });

  describe('Stats (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('GET /api/stats should return stats', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body.finishedWeeksCount).toBe(0);
    });
  });

  describe('Forgot/Reset password', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('POST /api/auth/forgot-password should return ok for existing user with email', async () => {
      const agent = await authedAgent();
      await agent.put('/api/me/recovery-email').send({ email: 'alice@test.com' });
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ username: 'alice' });
      expect(res.status).toBe(200);
      expect(res.body.hasEmail).toBe(true);
    });

    it('POST /api/auth/forgot-password should return hasEmail=false for user without recovery email', async () => {
      const agent = await authedAgent();
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ username: 'alice' });
      expect(res.status).toBe(200);
      expect(res.body.hasEmail).toBe(false);
    });

    it('POST /api/auth/reset-password should reset password with valid token', async () => {
      const agent = await authedAgent();
      await agent.put('/api/me/recovery-email').send({ email: 'alice@test.com' });
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ username: 'alice' });

      const { load } = require('../db/jsondb');
      const data = load();
      const reset = data.passwordResets[0];

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: reset.token, newPassword: 'newpass456' });
      expect(res.status).toBe(200);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'newpass456' });
      expect(loginRes.status).toBe(200);
    });

    it('POST /api/auth/reset-password should reject expired tokens', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', newPassword: 'newpass456' });
      expect(res.status).toBe(400);
    });

    it('POST /api/auth/reset-password should reject short passwords', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'some-token', newPassword: 'ab' });
      expect(res.status).toBe(400);
    });
  });

  describe('Set last completed (manual history)', () => {
    function authedAgentWithTask() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Manual Task', frequencyLabel: 'Semanal' }))
        .then(() => agent);
    }

    it('POST /api/tasks/:id/set-last-completed should register manual completion', async () => {
      const agent = await authedAgentWithTask();
      const tasks = await agent.get('/api/tasks');
      const taskId = tasks.body.tasks[0].id;
      const me = await agent.get('/api/me');

      const res = await agent
        .post('/api/tasks/' + taskId + '/set-last-completed')
        .send({ userId: me.body.user.id, date: '2024-01-01' });
      expect(res.status).toBe(200);
      expect(res.body.assignment.manualEntry).toBe(true);
    });

    it('POST /api/tasks/:id/set-last-completed should reject without userId or date', async () => {
      const agent = await authedAgentWithTask();
      const tasks = await agent.get('/api/tasks');
      const taskId = tasks.body.tasks[0].id;

      const res = await agent
        .post('/api/tasks/' + taskId + '/set-last-completed')
        .send({ userId: 'u1' });
      expect(res.status).toBe(400);
    });
  });

  describe('Pin task to user (authenticated)', () => {
    function setupWithTask() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Pinned Task', frequencyLabel: 'Semanal' }))
        .then(() => agent);
    }

    async function memberIds(agent) {
      const me = await agent.get('/api/me');
      const other = me.body.members.find(m => m.id !== me.body.user.id);
      return { currentUserId: me.body.user.id, otherId: other.id };
    }

    it('PUT /api/tasks/:id/pin should set pin fields and move the current-week assignment to the pinned user', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      // Before the pin the task is with the low-load current user (not the pinned one).
      const beforeRow = weekRes.body.all.find(a => a.taskId === taskId);
      expect(beforeRow.assignedToUserId).not.toBe(otherId);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek });
      expect(res.status).toBe(200);
      expect(res.body.task.pinnedToUserId).toBe(otherId);
      expect(res.body.task.pinnedFromWeek).toBe(currentWeek);
      expect(res.body.task.pinnedToWeek).toBe(currentWeek);

      const after = await agent.get('/api/assignments');
      const afterRow = after.body.all.find(a => a.taskId === taskId);
      expect(afterRow.assignedToUserId).toBe(otherId);
    });

    it('PUT /api/tasks/:id/pin should clear pin fields without regenerating the current week', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const pin = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek });
      expect(pin.status).toBe(200);
      const pinnedRowId = (await agent.get('/api/assignments')).body.all.find(a => a.taskId === taskId).id;

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: null });
      expect(res.status).toBe(200);
      expect(res.body.task.pinnedToUserId).toBeNull();
      expect(res.body.task.pinnedFromWeek).toBeNull();
      expect(res.body.task.pinnedToWeek).toBeNull();

      // No regeneration: same row, still with the pinned user, no duplicates.
      const after = await agent.get('/api/assignments');
      const rows = after.body.all.filter(a => a.taskId === taskId && a.weekStart === after.body.weekStart);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(pinnedRowId);
      expect(rows[0].assignedToUserId).toBe(otherId);
    });

    it('PUT /api/tasks/:id/pin should be idempotent when set twice', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const body = { pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek };
      const first = await agent.put('/api/tasks/' + taskId + '/pin').send(body);
      expect(first.status).toBe(200);
      const second = await agent.put('/api/tasks/' + taskId + '/pin').send(body);
      expect(second.status).toBe(200);

      const after = await agent.get('/api/assignments');
      const rows = after.body.all.filter(a => a.taskId === taskId && a.weekStart === after.body.weekStart);
      expect(rows).toHaveLength(1);
      expect(rows[0].assignedToUserId).toBe(otherId);
    });

    it('PUT /api/tasks/:id/pin should return 400 when fromWeek is in the past', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: addDays(currentWeek, -7), pinnedToWeek: currentWeek });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('La semana de inicio no puede ser anterior a la actual.');

      // No pin fields written on rejection.
      const tasks = await agent.get('/api/tasks');
      expect(tasks.body.tasks[0].pinnedToUserId).toBeUndefined();
    });

    it('PUT /api/tasks/:id/pin should return 400 when toWeek is before fromWeek', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: addDays(currentWeek, -7) });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('La semana final no puede ser anterior a la inicial.');
    });

    it('PUT /api/tasks/:id/pin should return 400 when the user is not a household member', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: 'not-a-member', pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('La persona tiene que ser parte del hogar.');
    });

    it('PUT /api/tasks/:id/pin should return 400 when week fields are missing', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const { otherId } = await memberIds(agent);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Fechas inválidas.');
    });

    it('PUT /api/tasks/:id/pin should return 400 for malformed week format', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const { otherId } = await memberIds(agent);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: 'not-a-date', pinnedToWeek: weekRes.body.weekStart });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Fechas inválidas.');
    });

    it('PUT /api/tasks/:id/pin should return 404 for a missing task', async () => {
      const agent = await setupWithTask();
      const weekRes = await agent.get('/api/assignments');
      const { otherId } = await memberIds(agent);

      const res = await agent
        .put('/api/tasks/nonexistent/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: weekRes.body.weekStart, pinnedToWeek: weekRes.body.weekStart });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Tarea no encontrada.');
    });

    it('PUT /api/tasks/:id/pin should return 404 for a task from another household', async () => {
      const agent1 = request.agent(app);
      await createHousehold(agent1);
      const created = await agent1.post('/api/tasks').send({ name: 'Private Task', frequencyLabel: 'Semanal' });
      const taskId = created.body.task.id;
      const week1 = await agent1.get('/api/assignments');
      const me1 = await agent1.get('/api/me');
      const otherId1 = me1.body.members.find(m => m.id !== me1.body.user.id).id;

      const agent2 = request.agent(app);
      await agent2
        .post('/api/auth/register-household')
        .send({
          householdName: 'Other Home',
          members: [
            { name: 'Charlie', username: 'charlie', password: 'pass' },
            { name: 'Diana', username: 'diana', password: 'pass' }
          ]
        });

      const res = await agent2
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId1, pinnedFromWeek: week1.body.weekStart, pinnedToWeek: week1.body.weekStart });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Tarea no encontrada.');
    });

    it('PUT /api/tasks/:id/pin should reassign an overdue carried assignment to the pinned user', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      // No tasks yet: learn the server week without generating any assignment rows.
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const created = await agent.post('/api/tasks').send({ name: 'Carry Task', frequencyLabel: 'Semanal' });
      const taskId = created.body.task.id;

      // Overdue pending row in the past week, left uncompleted.
      const pastWeek = addDays(currentWeek, -7);
      await agent.post('/api/assignments/generate').send({ weekStart: pastWeek });
      const histBefore = await agent.get('/api/history?weekStart=' + pastWeek);
      const pastRow = Object.values(histBefore.body.byUser).flatMap(u => u.tasks).find(a => a.taskId === taskId);
      expect(pastRow.status).toBe('pending');
      expect(pastRow.assignedToUserId).not.toBe(otherId);

      const pinRes = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek });
      expect(pinRes.status).toBe(200);

      // Current week: pin wins over carry-over -> assigned to the pinned user.
      const cur = await agent.get('/api/assignments');
      const curRow = cur.body.all.find(a => a.taskId === taskId);
      expect(curRow.assignedToUserId).toBe(otherId);

      // Past week: original row is preserved as carried.
      const histAfter = await agent.get('/api/history?weekStart=' + pastWeek);
      const pastRowAfter = Object.values(histAfter.body.byUser).flatMap(u => u.tasks).find(a => a.taskId === taskId);
      expect(pastRowAfter.status).toBe('carried');
    });

    it('PUT /api/tasks/:id/pin should not modify a done row for the current week', async () => {
      const agent = await setupWithTask();
      const taskId = (await agent.get('/api/tasks')).body.tasks[0].id;
      const weekRes = await agent.get('/api/assignments');
      const currentWeek = weekRes.body.weekStart;
      const { otherId } = await memberIds(agent);

      const row = weekRes.body.all.find(a => a.taskId === taskId);
      const complete = await agent.post('/api/assignments/' + row.id + '/complete');
      expect(complete.status).toBe(200);

      const res = await agent
        .put('/api/tasks/' + taskId + '/pin')
        .send({ pinnedToUserId: otherId, pinnedFromWeek: currentWeek, pinnedToWeek: currentWeek });
      expect(res.status).toBe(200);

      const after = await agent.get('/api/assignments');
      const rows = after.body.all.filter(a => a.taskId === taskId && a.weekStart === after.body.weekStart);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(row.id);
      expect(rows[0].status).toBe('done');
      expect(rows[0].assignedToUserId).toBe(row.assignedToUserId);
    });
  });

  describe('Swap respond', () => {
    it('POST /api/swaps/:id/respond should reject invalid decision', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await agent.post('/api/swaps/nonexistent/respond').send({ decision: 'maybe' });
      expect(res.status).toBe(400);
    });

    it('POST /api/swaps/:id/respond should reject non-existent swap', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await agent.post('/api/swaps/nonexistent/respond').send({ decision: 'accept' });
      expect(res.status).toBe(404);
    });

    it('POST /api/swaps/:id/respond should accept a swap', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      await agent.post('/api/tasks').send({ name: 'Task A', frequencyLabel: 'Semanal' });
      await agent.post('/api/tasks').send({ name: 'Task B', frequencyLabel: 'Semanal' });
      await agent.post('/api/assignments/generate');
      const week = await agent.get('/api/assignments');
      const all = week.body.all;
      const currentUserId = week.body.currentUserId;
      const myTask = all.find(a => a.assignedToUserId === currentUserId);
      const partnerTask = all.find(a => a.assignedToUserId !== currentUserId);
      const swap = await agent
        .post('/api/swaps')
        .send({ fromAssignmentId: myTask.id, toAssignmentId: partnerTask.id, message: 'swap' });
      const swapId = swap.body.swap.id;

      const partnerAgent = request.agent(app);
      await partnerAgent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      const res = await partnerAgent.post('/api/swaps/' + swapId + '/respond').send({ decision: 'accept', responseMessage: 'ok' });
      expect(res.status).toBe(200);
      expect(res.body.swap.status).toBe('accepted');
    });

    it('POST /api/swaps/:id/respond should deny a swap', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      await agent.post('/api/tasks').send({ name: 'Task C', frequencyLabel: 'Semanal' });
      await agent.post('/api/tasks').send({ name: 'Task D', frequencyLabel: 'Semanal' });
      await agent.post('/api/assignments/generate');
      const week = await agent.get('/api/assignments');
      const all = week.body.all;
      const currentUserId = week.body.currentUserId;
      const myTask = all.find(a => a.assignedToUserId === currentUserId);
      const partnerTask = all.find(a => a.assignedToUserId !== currentUserId);
      const swap = await agent
        .post('/api/swaps')
        .send({ fromAssignmentId: myTask.id, toAssignmentId: partnerTask.id });
      const swapId = swap.body.swap.id;

      const partnerAgent = request.agent(app);
      await partnerAgent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      const res = await partnerAgent.post('/api/swaps/' + swapId + '/respond').send({ decision: 'deny' });
      expect(res.status).toBe(200);
      expect(res.body.swap.status).toBe('denied');
    });

    it('POST /api/swaps/:id/respond should reject already responded', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      await agent.post('/api/tasks').send({ name: 'Task E', frequencyLabel: 'Semanal' });
      await agent.post('/api/tasks').send({ name: 'Task F', frequencyLabel: 'Semanal' });
      await agent.post('/api/assignments/generate');
      const week = await agent.get('/api/assignments');
      const all = week.body.all;
      const myTask = all.find(a => a.assignedToUserId === week.body.currentUserId);
      const partnerTask = all.find(a => a.assignedToUserId !== week.body.currentUserId);
      const swap = await agent
        .post('/api/swaps')
        .send({ fromAssignmentId: myTask.id, toAssignmentId: partnerTask.id });
      const swapId = swap.body.swap.id;

      const partnerAgent = request.agent(app);
      await partnerAgent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      await partnerAgent.post('/api/swaps/' + swapId + '/respond').send({ decision: 'accept' });
      const res = await partnerAgent.post('/api/swaps/' + swapId + '/respond').send({ decision: 'accept' });
      expect(res.status).toBe(400);
    });
  });

  describe('Complete assignment', () => {
    function authedAgentWithAssignments() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'My Task', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/assignments/generate'))
        .then(() => agent);
    }

    it('POST /api/assignments/:id/complete should mark task done', async () => {
      const agent = await authedAgentWithAssignments();
      const week = await agent.get('/api/assignments');
      const myTask = week.body.all.find(a => a.assignedToUserId === week.body.currentUserId);
      const res = await agent.post('/api/assignments/' + myTask.id + '/complete');
      expect(res.status).toBe(200);
      expect(res.body.assignment.status).toBe('done');
    });

    it('POST /api/assignments/:id/complete should reject non-existent task', async () => {
      const agent = await authedAgentWithAssignments();
      const res = await agent.post('/api/assignments/nonexistent/complete');
      expect(res.status).toBe(404);
    });

    it('POST /api/assignments/:id/complete should reject other users tasks', async () => {
      const agent = await authedAgentWithAssignments();
      const partnerAgent = request.agent(app);
      await partnerAgent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      const week = await agent.get('/api/assignments');
      const myTask = week.body.all.find(a => a.assignedToUserId === week.body.currentUserId);
      const res = await partnerAgent.post('/api/assignments/' + myTask.id + '/complete');
      expect(res.status).toBe(403);
    });

    it('POST /api/assignments/:id/complete should reject already done tasks', async () => {
      const agent = await authedAgentWithAssignments();
      const week = await agent.get('/api/assignments');
      const myTask = week.body.all.find(a => a.assignedToUserId === week.body.currentUserId);
      await agent.post('/api/assignments/' + myTask.id + '/complete');
      const res = await agent.post('/api/assignments/' + myTask.id + '/complete');
      expect(res.status).toBe(400);
    });
  });

  describe('Notification read', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('POST /api/notifications/:id/read should mark notification as read', async () => {
      const agent = await authedAgent();
      await agent.post('/api/tasks').send({ name: 'Notif Task', frequencyLabel: 'Semanal' });
      await agent.post('/api/assignments/generate');
      const week = await agent.get('/api/assignments');
      const myTask = week.body.all.find(a => a.assignedToUserId === week.body.currentUserId);
      await agent.post('/api/assignments/' + myTask.id + '/complete');

      const notifs = await agent.get('/api/notifications');
      const unread = notifs.body.notifications.filter(n => !n.read);
      if (unread.length > 0) {
        const res = await agent.post('/api/notifications/' + unread[0].id + '/read');
        expect(res.status).toBe(200);
        const refreshed = await agent.get('/api/notifications');
        const found = refreshed.body.notifications.find(n => n.id === unread[0].id);
        expect(found.read).toBe(true);
      }
    });
  });

  describe('Register validation', () => {
    it('POST /api/auth/register-household should reject member without name', async () => {
      const res = await request(app)
        .post('/api/auth/register-household')
        .send({ householdName: 'Test', members: [{ name: '', username: 'x', password: '1234' }] });
      expect(res.status).toBe(400);
    });

    it('POST /api/auth/register-household should reject duplicate username', async () => {
      const agent = request.agent(app);
      await createHousehold(agent);
      const res = await request(app)
        .post('/api/auth/register-household')
        .send({
          householdName: 'Other',
          members: [{ name: 'Charlie', username: 'alice', password: 'pass' }]
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('ya está en uso');
    });
  });

  describe('History with data', () => {
    function setupWithHistory() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Hist Task', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/assignments/generate').send({ weekStart: '2024-01-07' }))
        .then(() => agent.post('/api/assignments/generate').send({ weekStart: '2024-01-14' }))
        .then(() => agent);
    }

    it('GET /api/weeks should list past weeks', async () => {
      const agent = await setupWithHistory();
      const res = await agent.get('/api/weeks');
      expect(res.status).toBe(200);
      expect(res.body.weeks.length).toBeGreaterThanOrEqual(2);
    });

    it('GET /api/history should return history for a specific week', async () => {
      const agent = await setupWithHistory();
      const res = await agent.get('/api/history?weekStart=2024-01-07');
      expect(res.status).toBe(200);
      expect(res.body.weekStart).toBe('2024-01-07');
      expect(res.body.byUser).toBeDefined();
    });
  });

  describe('Edit task with custom days', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('PUT /api/tasks/:id should update custom frequency', async () => {
      const agent = await authedAgent();
      const created = await agent
        .post('/api/tasks')
        .send({ name: 'Flex', frequencyLabel: 'Personalizado', customDays: '5' });
      const taskId = created.body.task.id;

      const res = await agent
        .put('/api/tasks/' + taskId)
        .send({ frequencyLabel: 'Personalizado', customDays: '10' });
      expect(res.status).toBe(200);
      expect(res.body.task.frequencyDays).toBe(10);
    });
  });

  describe('Celebration notification (all tasks done)', () => {
    function setupWithOneTaskEach() {
      const agent = request.agent(app);
      return createHousehold(agent)
        .then(() => agent.post('/api/tasks').send({ name: 'Single', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/tasks').send({ name: 'Second', frequencyLabel: 'Semanal' }))
        .then(() => agent.post('/api/assignments/generate'))
        .then(() => agent);
    }

    it('should notify partner when all tasks are completed', async () => {
      const agent = await setupWithOneTaskEach();
      const week = await agent.get('/api/assignments');
      const myTasks = week.body.all.filter(a => a.assignedToUserId === week.body.currentUserId);

      for (const t of myTasks) {
        await agent.post('/api/assignments/' + t.id + '/complete');
      }

      const partnerAgent = request.agent(app);
      await partnerAgent.post('/api/auth/login').send({ username: 'bob', password: 'pass456' });
      const notifs = await partnerAgent.get('/api/notifications');
      expect(notifs.body.notifications.length).toBeGreaterThanOrEqual(1);
      const infoNotif = notifs.body.notifications.find(n => n.type === 'info');
      expect(infoNotif).toBeDefined();
      expect(infoNotif.message).toContain('completó');
    });
  });

  describe('Global Tasks (authenticated)', () => {
    function authedAgent() {
      const agent = request.agent(app);
      return createHousehold(agent).then(() => agent);
    }

    it('GET /api/global-tasks should return empty list initially', async () => {
      const agent = await authedAgent();
      const res = await agent.get('/api/global-tasks');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toEqual([]);
    });

    it('POST /api/global-tasks should create a task', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/global-tasks')
        .send({ name: 'Fix leaking faucet', description: 'Kitchen sink' });
      expect(res.status).toBe(200);
      expect(res.body.task.name).toBe('Fix leaking faucet');
      expect(res.body.task.description).toBe('Kitchen sink');
      expect(res.body.task.status).toBe('pending');
    });

    it('POST /api/global-tasks should reject missing name', async () => {
      const agent = await authedAgent();
      const res = await agent
        .post('/api/global-tasks')
        .send({ description: 'No name here' });
      expect(res.status).toBe(400);
    });

    it('GET /api/global-tasks should list created tasks in reverse order', async () => {
      const agent = await authedAgent();
      await agent.post('/api/global-tasks').send({ name: 'Task A' });
      await agent.post('/api/global-tasks').send({ name: 'Task B' });
      const res = await agent.get('/api/global-tasks');
      expect(res.status).toBe(200);
      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.tasks[0].name).toBe('Task B');
    });

    it('PUT /api/global-tasks/:id should update a task', async () => {
      const agent = await authedAgent();
      const created = await agent.post('/api/global-tasks').send({ name: 'Old name' });
      const taskId = created.body.task.id;

      const res = await agent
        .put('/api/global-tasks/' + taskId)
        .send({ name: 'New name', description: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.task.name).toBe('New name');
      expect(res.body.task.description).toBe('Updated');
    });

    it('PUT /api/global-tasks/:id should return 404 for non-existent', async () => {
      const agent = await authedAgent();
      const res = await agent
        .put('/api/global-tasks/nonexistent')
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('POST /api/global-tasks/:id/toggle should mark task as done', async () => {
      const agent = await authedAgent();
      const created = await agent.post('/api/global-tasks').send({ name: 'Toggle me' });
      const taskId = created.body.task.id;

      const res = await agent.post('/api/global-tasks/' + taskId + '/toggle');
      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe('done');
      expect(res.body.task.completedByUserName).toBe('Alice');
    });

    it('POST /api/global-tasks/:id/toggle should re-open a done task', async () => {
      const agent = await authedAgent();
      const created = await agent.post('/api/global-tasks').send({ name: 'Reopen me' });
      const taskId = created.body.task.id;

      await agent.post('/api/global-tasks/' + taskId + '/toggle');
      const res = await agent.post('/api/global-tasks/' + taskId + '/toggle');
      expect(res.status).toBe(200);
      expect(res.body.task.status).toBe('pending');
      expect(res.body.task.completedAt).toBeNull();
    });

    it('POST /api/global-tasks/:id/toggle should return 404 for non-existent', async () => {
      const agent = await authedAgent();
      const res = await agent.post('/api/global-tasks/nonexistent/toggle');
      expect(res.status).toBe(404);
    });

    it('DELETE /api/global-tasks/:id should delete a task', async () => {
      const agent = await authedAgent();
      const created = await agent.post('/api/global-tasks').send({ name: 'Delete me' });
      const taskId = created.body.task.id;

      const res = await agent.delete('/api/global-tasks/' + taskId);
      expect(res.status).toBe(200);

      const list = await agent.get('/api/global-tasks');
      expect(list.body.tasks).toHaveLength(0);
    });

    it('DELETE /api/global-tasks/:id should return 404 for non-existent', async () => {
      const agent = await authedAgent();
      const res = await agent.delete('/api/global-tasks/nonexistent');
      expect(res.status).toBe(404);
    });

    it('should not see other household global tasks', async () => {
      const agent1 = request.agent(app);
      await createHousehold(agent1);
      await agent1.post('/api/global-tasks').send({ name: 'Household 1 task' });

      const agent2 = request.agent(app);
      await agent2
        .post('/api/auth/register-household')
        .send({
          householdName: 'Other Home',
          members: [
            { name: 'Charlie', username: 'charlie', password: 'pass' },
            { name: 'Diana', username: 'diana', password: 'pass' }
          ]
        });

      const res = await agent2.get('/api/global-tasks');
      expect(res.body.tasks).toHaveLength(0);
    });
  });
});
