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
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import activityRoutes from './activity';
import authRoutes from './auth';

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
  app.use('/activity', activityRoutes);
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

async function seedRequestAndVote() {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);
  const requestRepo = getRepository(MediaRequest);
  const voteRepo = getRepository(RequestVote);

  const admin = await userRepo.findOneOrFail({
    where: { email: 'admin@sinerr.dev' },
  });
  const friend = await userRepo.findOneOrFail({
    where: { email: 'friend@sinerr.dev' },
  });

  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 13579,
      status: MediaStatus.UNKNOWN,
    })
  );

  const createdRequest = await requestRepo.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy: admin,
    })
  );

  await voteRepo.save(
    new RequestVote({ request: createdRequest, user: friend })
  );

  return createdRequest;
}

describe('GET /activity', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/activity');
    assert.strictEqual(res.status, 403);
  });

  it('returns request and vote activity merged by recency', async () => {
    await seedRequestAndVote();

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get('/activity');

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 2);

    const types = res.body.results.map((item: { type: string }) => item.type);
    assert.ok(types.includes('request'));
    assert.ok(types.includes('vote'));

    const requestItem = res.body.results.find(
      (item: { type: string }) => item.type === 'request'
    );
    assert.strictEqual(requestItem.payload.tmdbId, 13579);
    assert.strictEqual(requestItem.payload.mediaType, 'movie');

    const voteItem = res.body.results.find(
      (item: { type: string }) => item.type === 'vote'
    );
    assert.strictEqual(voteItem.payload.tmdbId, 13579);
    assert.strictEqual(voteItem.actor.displayName, 'friend');
  });

  it('supports take and skip pagination', async () => {
    await seedRequestAndVote();

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get('/activity?take=1&skip=0');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 1);
  });

  it('returns an empty result set when there is no activity', async () => {
    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get('/activity');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.results, []);
  });
});
