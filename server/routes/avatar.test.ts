import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import { appDataPath } from '@server/utils/appDataVolume';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import { promises as fs } from 'fs';
import { join } from 'path';
import request from 'supertest';
import authRoutes from './auth';
import userRoutes from './user';

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

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

/** 1x1 PNG 字节 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function cleanupAvatarFiles(userId: number) {
  const dir = join(appDataPath(), 'avatars');
  const files = await fs.readdir(dir).catch(() => []);
  for (const f of files) {
    if (f.startsWith(`${userId}.`)) {
      await fs.unlink(join(dir, f)).catch(() => {});
    }
  }
}

describe('avatar upload / delete', () => {
  it('uploads a valid PNG avatar and updates user.avatar', async () => {
    const friend = await getRepository(User).findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    await cleanupAvatarFiles(friend.id);

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent
      .post(`/user/${friend.id}/avatar`)
      .attach('avatar', TINY_PNG, {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.avatar, `/avatarproxy/upload/${friend.id}`);

    const updated = await getRepository(User).findOneOrFail({
      where: { id: friend.id },
    });
    assert.strictEqual(updated.avatar, `/avatarproxy/upload/${friend.id}`);
    await cleanupAvatarFiles(friend.id);
  });

  it('rejects a disallowed mime type', async () => {
    const friend = await getRepository(User).findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent
      .post(`/user/${friend.id}/avatar`)
      .attach('avatar', Buffer.from('<svg/>'), {
        filename: 'a.svg',
        contentType: 'image/svg+xml',
      });

    assert.strictEqual(res.status, 400);
  });

  it('removes the avatar and falls back to the media server avatar / default', async () => {
    const friend = await getRepository(User).findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    await cleanupAvatarFiles(friend.id);
    friend.avatar = '/avatarproxy/upload/' + friend.id;
    await getRepository(User).save(friend);

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.delete(`/user/${friend.id}/avatar`);

    assert.strictEqual(res.status, 200);
    // 无 jellyfinUserId → 回退默认
    assert.strictEqual(res.body.avatar, '/avatarproxy/default');
  });

  it('forbids updating another user avatar without MANAGE_USERS', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent
      .post(`/user/${admin.id}/avatar`)
      .attach('avatar', TINY_PNG, {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    assert.strictEqual(res.status, 403);
  });
});
