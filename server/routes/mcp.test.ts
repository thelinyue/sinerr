import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import mcpRoutes from '@server/routes/mcp';
import settingsRoutes from '@server/routes/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/settings', settingsRoutes);
  app.use('/mcp', mcpRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

async function loginAsAdmin() {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email: 'admin@sinerr.dev', password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

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
    const agent = await loginAsAdmin();
    const res = await agent.post('/settings/main').send({
      applicationTitle: 'Sinerr',
      mcpEnabled: true,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().main.mcpEnabled, true);
  });
});
