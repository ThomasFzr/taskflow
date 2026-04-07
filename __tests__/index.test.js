import { afterAll, describe, expect, it } from '@jest/globals';
const { default: request } = await import('supertest');
const { app, server } = await import('../src/index.js');

describe('🚀 API Tasks - Tests Approfondis', () => {

    afterAll((done) => {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    describe('GET /tasks', () => {
        it('✅ Récupérer toutes les tâches avec succès', async () => {
            const res = await request(app).get('/tasks');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body[0].title).toBe('Mock Task');
        });
    });

    describe('POST /tasks', () => {
        it('✅ Créer une tâche avec génération d\'ID', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({ title: 'Apprendre Jest' });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.completed).toBe(false);
        });

        it('❌ Rejeter une tâche sans title', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Title is required and must be a string');
        });

        it('❌ Rejeter un title trop long', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({ title: 'a'.repeat(501) });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Title must be between 1 and 500 characters');
        });

        it('✅ Créer une tâche avec date limite et couleur', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({
                title: 'Tâche avec échéance',
                dueDate: '2026-12-31T23:59:59.000Z',
                color: '#3b82f6',
              });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.completed).toBe(false);
            expect(res.body.dueDate).toBe('2026-12-31T23:59:59.000Z');
            expect(res.body.color).toBe('#3b82f6');
        });

        it('❌ Rejeter une couleur invalide', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({ title: 'Test', color: 'not-a-color' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('color');
        });
    });

    describe('PATCH /tasks/:id', () => {
        it('✅ Modifier partiellement une tâche', async () => {
            const res = await request(app)
              .patch('/tasks/1') // ID 1 est mocké comme existant
              .send({ completed: true });

            expect(res.status).toBe(200);
            expect(res.body.completed).toBe(true);
        });

        it('❌ Retourner 404 si la tâche n’existe pas', async () => {
            const res = await request(app)
              .patch('/tasks/999') // ID 999 simulé comme inexistant
              .send({ title: 'New' });
            expect(res.status).toBe(404);
        });

        it('✅ Mettre à jour la date limite', async () => {
            const res = await request(app)
              .patch('/tasks/1')
              .send({ dueDate: '2026-06-15T12:00:00.000Z' });

            expect(res.status).toBe(200);
            expect(res.body.dueDate).toBe('2026-06-15T12:00:00.000Z');
        });

        it('✅ Effacer la date limite avec null', async () => {
            const res = await request(app)
              .patch('/tasks/1')
              .send({ dueDate: null });

            expect(res.status).toBe(200);
            expect(res.body.dueDate).toBe(null);
        });
    });

    describe('POST /tasks/bulk-delete', () => {
        it('✅ Supprimer plusieurs tâches', async () => {
            const res = await request(app)
              .post('/tasks/bulk-delete')
              .send({ ids: ['1', '2'] });

            expect(res.status).toBe(200);
            expect(res.body.deleted).toBe(2);
            expect(res.body.ids).toEqual(['1', '2']);
        });

        it('❌ Rejeter une liste vide', async () => {
            const res = await request(app)
              .post('/tasks/bulk-delete')
              .send({ ids: [] });

            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /tasks/:id', () => {
        it('✅ Supprimer une tâche existante', async () => {
            const res = await request(app).delete('/tasks/1');
            expect(res.status).toBe(204);
        });
    });

});