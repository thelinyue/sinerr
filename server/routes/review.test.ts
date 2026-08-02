import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import reviewRoutes from './review';

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
  app.use('/review', reviewRoutes);
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

async function loginWithPermissions(email: string, permissions: number) {
  const userRepository = getRepository(User);
  const user = await userRepository.findOneOrFail({ where: { email } });
  user.permissions = permissions;
  await userRepository.save(user);
  return loginAs(email, 'test1234');
}

async function seedMedia() {
  const mediaRepo = getRepository(Media);
  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 24681,
      status: MediaStatus.UNKNOWN,
    })
  );
  return media;
}

describe('GET /review/:tmdbId/:mediaType', () => {
  it('returns an empty review list for media without reviews', async () => {
    await seedMedia();
    const agent = await loginAs('admin@sinerr.dev', 'test1234');

    const res = await agent.get('/review/24681/movie');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reviewCount, 0);
    assert.strictEqual(res.body.averageRating, 0);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('returns 404 for media that does not exist', async () => {
    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get('/review/99999999/movie');
    assert.strictEqual(res.status, 404);
  });

  it('rejects an invalid media type', async () => {
    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get('/review/24681/album');
    assert.strictEqual(res.status, 400);
  });
});

describe('POST /review/:tmdbId/:mediaType', () => {
  it('creates a review and reflects it in the list', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const create = await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Really enjoyed it!',
    });
    assert.strictEqual(create.status, 201);

    const list = await agent.get('/review/24681/movie');
    assert.strictEqual(list.body.reviewCount, 1);
    assert.strictEqual(list.body.averageRating, 4);
    assert.strictEqual(list.body.results[0].message, 'Really enjoyed it!');
    assert.strictEqual(list.body.results[0].user.displayName, 'friend');
  });

  it('rejects an out-of-range rating', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post('/review/24681/movie').send({
      rating: 6,
      message: 'Too high',
    });

    assert.strictEqual(res.status, 400);
  });

  it('rejects an empty message', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post('/review/24681/movie').send({
      rating: 3,
      message: '   ',
    });

    assert.strictEqual(res.status, 400);
  });

  it('rejects posting without the REQUEST permission', async () => {
    await seedMedia();
    const agent = await loginWithPermissions('friend@sinerr.dev', 0);

    const res = await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Nope',
    });

    assert.strictEqual(res.status, 403);
  });

  it('upserts when the same user posts twice', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'First take',
    });
    const second = await agent.post('/review/24681/movie').send({
      rating: 5,
      message: 'Second take',
    });

    assert.strictEqual(second.status, 201);

    const list = await agent.get('/review/24681/movie');
    assert.strictEqual(list.body.reviewCount, 1);
    assert.strictEqual(list.body.averageRating, 5);
    assert.strictEqual(list.body.results[0].message, 'Second take');
  });
});

describe('DELETE /review/:reviewId', () => {
  it('allows the author to delete their own review', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const create = await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Delete me',
    });
    const reviewId = create.body.id;

    const res = await agent.delete(`/review/${reviewId}`);
    assert.strictEqual(res.status, 204);

    const list = await agent.get('/review/24681/movie');
    assert.strictEqual(list.body.reviewCount, 0);
  });

  it('forbids deleting another user review without MANAGE_REQUESTS', async () => {
    await seedMedia();
    const authorAgent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );
    const create = await authorAgent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Mine',
    });
    const reviewId = create.body.id;

    const otherAgent = await loginWithPermissions(
      'admin@sinerr.dev',
      Permission.REQUEST
    );
    const res = await otherAgent.delete(`/review/${reviewId}`);
    assert.strictEqual(res.status, 403);
  });

  it('allows a user with MANAGE_REQUESTS to delete any review', async () => {
    await seedMedia();
    const authorAgent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );
    const create = await authorAgent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Mine',
    });
    const reviewId = create.body.id;

    const adminAgent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await adminAgent.delete(`/review/${reviewId}`);
    assert.strictEqual(res.status, 204);
  });

  it('returns 404 for a non-existent review', async () => {
    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.delete('/review/99999999');
    assert.strictEqual(res.status, 404);
  });
});
