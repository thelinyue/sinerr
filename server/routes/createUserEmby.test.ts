import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { getSettings } from '@server/lib/settings';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import type { Express } from 'express';

let app: Express;

before(async () => {
  app = createTestApp(userRoutes, '/user');
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

describe('create user with Emby account (module 8)', () => {
  it('sets the password explicitly after creating the Emby account', async () => {
    const settings = getSettings();
    const priorType = settings.main.mediaServerType;
    settings.main.mediaServerType = MediaServerType.EMBY;

    try {
      const agent = await loginAs(app, 'admin@sinerr.dev');
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
      const agent = await loginAs(app, 'admin@sinerr.dev');
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
