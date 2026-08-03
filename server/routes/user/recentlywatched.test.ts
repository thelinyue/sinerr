import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import PlaybackEvent from '@server/entity/PlaybackEvent';
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

async function seedPlayback() {
  const userRepo = getRepository(User);
  const playbackRepo = getRepository(PlaybackEvent);
  const friend = await userRepo.findOneOrFail({
    where: { email: 'friend@sinerr.dev' },
  });

  await playbackRepo.save([
    new PlaybackEvent({
      user: friend,
      tmdbId: 77701,
      mediaType: MediaType.MOVIE,
      completed: true,
      durationSeconds: 3600,
    }),
    new PlaybackEvent({
      user: friend,
      tmdbId: 77702,
      mediaType: MediaType.TV,
      completed: false,
      seasonNumber: 1,
      episodeNumber: 2,
      durationSeconds: 1800,
    }),
  ]);

  return friend;
}

describe('GET /user/:id/recently-watched', () => {
  it('returns playback records newest first with media metadata', async () => {
    const friend = await seedPlayback();

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 2);

    const movie = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === 77701
    );
    assert.strictEqual(movie.mediaType, 'movie');
    assert.strictEqual(movie.completed, true);
    assert.strictEqual(movie.durationSeconds, 3600);

    const tv = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === 77702
    );
    assert.strictEqual(tv.mediaType, 'tv');
    assert.strictEqual(tv.seasonNumber, 1);
    assert.strictEqual(tv.episodeNumber, 2);
  });

  it('allows an admin to view another user recently watched', async () => {
    const friend = await seedPlayback();

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 2);
  });

  it('forbids viewing another user recently watched without permission', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/recently-watched`);

    assert.strictEqual(res.status, 403);
  });

  it('returns an empty list for a user with no playback records', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.results, []);
  });
});
