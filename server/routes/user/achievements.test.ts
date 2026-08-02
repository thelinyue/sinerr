import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
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

describe('GET /user/:id/achievements', () => {
  it('reports no earned badges for a new user', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 6);
    assert.ok(res.body.results.every((b: { earned: boolean }) => !b.earned));
  });

  it('reports earned badges when thresholds are met', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const voteRepo = getRepository(RequestVote);

    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    // friend 提交 10 个请求
    for (let i = 0; i < 10; i++) {
      const media = await mediaRepo.save(
        new Media({
          mediaType: MediaType.MOVIE,
          tmdbId: 30000 + i,
          status: MediaStatus.UNKNOWN,
        })
      );
      const request = await requestRepo.save(
        new MediaRequest({
          type: MediaType.MOVIE,
          status: MediaRequestStatus.PENDING,
          media,
          requestedBy: friend,
        })
      );
      // admin 给每个请求点赞 => friend 获 10 赞
      await voteRepo.save(new RequestVote({ request, user: admin }));
    }

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
    const requester10 = res.body.results.find(
      (b: { id: string }) => b.id === 'requester10'
    );
    assert.ok(requester10.earned);
    assert.strictEqual(requester10.current, 10);

    const voted5 = res.body.results.find(
      (b: { id: string }) => b.id === 'voted5'
    );
    assert.ok(voted5.earned);
    assert.strictEqual(voted5.current, 10);
  });

  it('forbids viewing another user achievements without permission', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/achievements`);

    assert.strictEqual(res.status, 403);
  });

  it('allows a user to view their own achievements', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
  });
});
