import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getSettings } from '@server/lib/settings';
import mcpRoutes from '@server/routes/mcp';
import settingsRoutes from '@server/routes/settings';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import { Router, type Express } from 'express';
import request from 'supertest';

let app: Express;

before(async () => {
  app = createTestApp(
    Router().use('/settings', settingsRoutes).use('/mcp', mcpRoutes)
  );
});

setupTestDb();

describe('MCP endpoint (module 9)', () => {
  it('rejects requests when MCP is disabled', async () => {
    const settings = getSettings();
    const priorEnabled = settings.main.mcpEnabled;
    settings.main.mcpEnabled = false;
    try {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer some-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      assert.strictEqual(res.status, 401);
    } finally {
      settings.main.mcpEnabled = priorEnabled;
    }
  });

  it('rejects requests with the wrong token', async () => {
    const settings = getSettings();
    const priorEnabled = settings.main.mcpEnabled;
    const priorApiKey = settings.main.apiKey;
    settings.main.mcpEnabled = true;
    settings.main.apiKey = 'correct-token';
    try {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      assert.strictEqual(res.status, 401);
    } finally {
      settings.main.mcpEnabled = priorEnabled;
      settings.main.apiKey = priorApiKey;
    }
  });

  it('saves MCP settings via the admin settings endpoint', async () => {
    const agent = await loginAs(app, 'admin@sinerr.dev');
    const res = await agent.post('/settings/main').send({
      applicationTitle: 'Sinerr',
      mcpEnabled: true,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().main.mcpEnabled, true);
  });
});
