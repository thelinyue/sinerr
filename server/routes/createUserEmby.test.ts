import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import userRoutes from '@server/routes/user';
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
  app.use('/user', userRoutes);
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

const createUserMock = mock.method(
  JellyfinAPI.prototype,
  'createUser',
  async () => ({ Id: 'emby-user-guid', Name: 'newuser' })
).mock;
const updatePasswordMock = mock.method(
  JellyfinAPI.prototype,
  'updateUserPassword',
  async () => undefined
).mock;

beforeEach(() => {
  createUserMock.resetCalls();
  updatePasswordMock.resetCalls();
});

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

describe('create user with Emby account (module 8)', () => {
  it('sets the password explicitly after creating the Emby account', async () => {
    const settings = getSettings();
    const priorType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.EMBY;

    try {
      const agent = await loginAsAdmin();
      const res = await agent.post('/user').send({
        username: 'newuser',
        email: 'newuser@test.dev',
        password: 'secret123',
        createEmbyAccount: true,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(createUserMock.callCount(), 1);
      assert.strictEqual(updatePasswordMock.callCount(), 1);
      const [userId, password] = updatePasswordMock.calls[0].arguments;
      assert.strictEqual(userId, 'emby-user-guid');
      assert.strictEqual(password, 'secret123');
    } finally {
      settings.main.mediaServerType = priorType;
    }
  });

  it('does not touch the media server when createEmbyAccount is off', async () => {
    const settings = getSettings();
    const priorType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.EMBY;

    try {
      const agent = await loginAsAdmin();
      const res = await agent.post('/user').send({
        username: 'localonly',
        email: 'local@test.dev',
        password: 'secret123',
        createEmbyAccount: false,
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(createUserMock.callCount(), 0);
      assert.strictEqual(updatePasswordMock.callCount(), 0);
    } finally {
      settings.main.mediaServerType = priorType;
    }
  });
});
