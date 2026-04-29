import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../helpers/db.ts';
import { createApp } from '../../../src/server/app.ts';
import type { Database } from '../../../src/server/db/index.ts';

describe('createApp', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('should create a Hono app instance', () => {
    const app = createApp(db as unknown as Database);
    expect(app).toBeDefined();
    expect(app.fetch).toBeTypeOf('function');
  });

  it('should respond to GET /api/system/health', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/system/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('should respond to GET /api/notebooks with empty array', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/notebooks');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('should respond to GET /api/notes with empty array', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/notes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('should respond to GET /api/tags with empty array', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/tags');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('should respond to GET /api/search with empty results', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/search');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.message).toBeDefined();
  });

  it('should respond to GET /api/plugins with empty array', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/plugins');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('should include CORS headers in responses', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/system/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(200);
    // CORS middleware should set Access-Control-Allow-Origin
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  it('should handle CORS preflight requests', async () => {
    const app = createApp(db as unknown as Database);
    const res = await app.request('/api/system/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });
    // Preflight should return 204 or 200
    expect(res.status).toBeLessThanOrEqual(204);
  });
});

describe('Notebooks API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── POST /api/notebooks ──────────────────────────────────────────

  it('should create a notebook', async () => {
    const res = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Notebook' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('My Notebook');
    expect(body.id).toBeDefined();
    expect(body.stack_id).toBeNull();
  });

  it('should return 400 when creating notebook with empty name', async () => {
    const res = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.field).toBe('name');
  });

  it('should return 400 when creating notebook without name', async () => {
    const res = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 when creating notebook with duplicate name', async () => {
    await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate' }),
    });
    const res = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_NAME');
  });

  // ── GET /api/notebooks ───────────────────────────────────────────

  it('should list notebooks with note counts', async () => {
    await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NB1' }),
    });
    await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NB2' }),
    });

    const res = await app.request('/api/notebooks');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty('note_count');
    expect(body[0]).toHaveProperty('stack_name');
  });

  // ── PUT /api/notebooks/:id ───────────────────────────────────────

  it('should rename a notebook', async () => {
    const createRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Original' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebooks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Renamed');
  });

  it('should return 404 when updating non-existent notebook', async () => {
    const res = await app.request('/api/notebooks/nonexistent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 400 when updating notebook with empty name', async () => {
    const createRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebooks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 when renaming notebook to duplicate name', async () => {
    await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First' }),
    });
    const createRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second' }),
    });
    const second = await createRes.json();

    const res = await app.request(`/api/notebooks/${second.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_NAME');
  });

  // ── DELETE /api/notebooks/:id ────────────────────────────────────

  it('should delete a notebook', async () => {
    const createRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebooks/${created.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's gone
    const listRes = await app.request('/api/notebooks');
    const list = await listRes.json();
    expect(list).toHaveLength(0);
  });

  it('should return 404 when deleting non-existent notebook', async () => {
    const res = await app.request('/api/notebooks/nonexistent', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // ── Notebook with stack ──────────────────────────────────────────

  it('should create a notebook in a stack', async () => {
    // Create a stack first
    const stackRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Stack' }),
    });
    const stack = await stackRes.json();

    const res = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'In Stack', stackId: stack.id }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.stack_id).toBe(stack.id);
  });

  it('should auto-clean empty stacks after deleting last notebook', async () => {
    // Create stack and notebook
    const stackRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'AutoClean Stack' }),
    });
    const stack = await stackRes.json();

    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Only NB', stackId: stack.id }),
    });
    const nb = await nbRes.json();

    // Delete the notebook — stack should be auto-cleaned
    await app.request(`/api/notebooks/${nb.id}`, { method: 'DELETE' });

    // Verify stack is gone by trying to rename it
    const updateRes = await app.request(`/api/notebook-stacks/${stack.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Not Exist' }),
    });
    expect(updateRes.status).toBe(404);
  });

  it('should auto-clean empty stacks after moving notebook to different stack', async () => {
    // Create two stacks
    const stack1Res = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stack A' }),
    });
    const stack1 = await stack1Res.json();

    const stack2Res = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stack B' }),
    });
    const stack2 = await stack2Res.json();

    // Create notebook in stack1
    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Movable NB', stackId: stack1.id }),
    });
    const nb = await nbRes.json();

    // Move notebook to stack2
    await app.request(`/api/notebooks/${nb.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackId: stack2.id }),
    });

    // Stack1 should be auto-cleaned
    const updateRes = await app.request(`/api/notebook-stacks/${stack1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Should Not Exist' }),
    });
    expect(updateRes.status).toBe(404);
  });
});

describe('Notebook Stacks API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createTestDatabase();
    app = createApp(db as unknown as Database);
  });

  afterEach(() => {
    db.close();
  });

  // ── POST /api/notebook-stacks ────────────────────────────────────

  it('should create a stack', async () => {
    const res = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Stack' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('My Stack');
    expect(body.id).toBeDefined();
  });

  it('should return 400 when creating stack with empty name', async () => {
    const res = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 when creating stack with duplicate name', async () => {
    await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dup Stack' }),
    });
    const res = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dup Stack' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_NAME');
  });

  // ── PUT /api/notebook-stacks/:id ─────────────────────────────────

  it('should rename a stack', async () => {
    const createRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Old Name' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebook-stacks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('New Name');
  });

  it('should return 404 when renaming non-existent stack', async () => {
    const res = await app.request('/api/notebook-stacks/nonexistent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should return 400 when renaming stack with empty name', async () => {
    const createRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Stack' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebook-stacks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 when renaming stack to duplicate name', async () => {
    await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Existing' }),
    });
    const createRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToRename' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebook-stacks/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Existing' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DUPLICATE_NAME');
  });

  // ── DELETE /api/notebook-stacks/:id ──────────────────────────────

  it('should delete a stack', async () => {
    const createRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete' }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/notebook-stacks/${created.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('should return 404 when deleting non-existent stack', async () => {
    const res = await app.request('/api/notebook-stacks/nonexistent', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should set notebooks stack_id to null when stack is deleted', async () => {
    // Create stack and notebook
    const stackRes = await app.request('/api/notebook-stacks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Deletable Stack' }),
    });
    const stack = await stackRes.json();

    await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NB in Stack', stackId: stack.id }),
    });

    // Delete the stack
    await app.request(`/api/notebook-stacks/${stack.id}`, { method: 'DELETE' });

    // Notebook should still exist but with null stack_id
    const listRes = await app.request('/api/notebooks');
    const notebooks = await listRes.json();
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0].name).toBe('NB in Stack');
    expect(notebooks[0].stack_id).toBeNull();
  });
});

// ── Plugins API ────────────────────────────────────────────────────

import { createPluginRegistry, type PluginRegistry, type PluginManifest } from '../../../src/server/plugins/registry.ts';

describe('Plugins API', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let registry: PluginRegistry;

  beforeEach(() => {
    db = createTestDatabase();
    registry = createPluginRegistry(db as unknown as Database);
    app = createApp(db as unknown as Database, registry as unknown as PluginRegistry);
  });

  afterEach(() => {
    db.close();
  });

  // ── GET /api/plugins ─────────────────────────────────────────────

  it('should return empty array when no plugins loaded', async () => {
    const res = await app.request('/api/plugins');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('should list loaded plugins', async () => {
    const manifest: PluginManifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      extensionPoints: [{ type: 'theme', entrypoint: './theme.css' }],
    };
    registry.loadPlugin(manifest, '/fake/path');

    const res = await app.request('/api/plugins');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('test-plugin');
    expect(body[0].version).toBe('1.0.0');
    expect(body[0].description).toBe('A test plugin');
    expect(body[0].enabled).toBe(true);
    expect(body[0].extensionPoints).toHaveLength(1);
  });

  // ── PUT /api/plugins/:name/enable ────────────────────────────────

  it('should enable a disabled plugin', async () => {
    db.prepare('INSERT INTO plugins (name, enabled) VALUES (?, ?)').run('my-plugin', 0);
    const manifest: PluginManifest = {
      name: 'my-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './t.css' }],
    };
    registry.loadPlugin(manifest, '/fake/path');

    const res = await app.request('/api/plugins/my-plugin/enable', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's enabled in the list
    const listRes = await app.request('/api/plugins');
    const plugins = await listRes.json();
    expect(plugins[0].enabled).toBe(true);
  });

  it('should return 404 when enabling non-existent plugin', async () => {
    const res = await app.request('/api/plugins/nonexistent/enable', { method: 'PUT' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // ── PUT /api/plugins/:name/disable ───────────────────────────────

  it('should disable an enabled plugin', async () => {
    const manifest: PluginManifest = {
      name: 'active-plugin',
      version: '1.0.0',
      extensionPoints: [{ type: 'theme', entrypoint: './t.css' }],
    };
    registry.loadPlugin(manifest, '/fake/path');

    const res = await app.request('/api/plugins/active-plugin/disable', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it's disabled in the list
    const listRes = await app.request('/api/plugins');
    const plugins = await listRes.json();
    expect(plugins[0].enabled).toBe(false);
  });

  it('should return 404 when disabling non-existent plugin', async () => {
    const res = await app.request('/api/plugins/nonexistent/disable', { method: 'PUT' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // ── GET /api/plugins/:name/assets/* ──────────────────────────────

  it('should return 404 for assets of non-existent plugin', async () => {
    const res = await app.request('/api/plugins/nonexistent/assets/theme.css');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
