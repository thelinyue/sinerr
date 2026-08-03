import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import PlaybackEvent from '@server/entity/PlaybackEvent';
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

async function seedTvMedia() {
  const mediaRepo = getRepository(Media);
  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.TV,
      tmdbId: 24682,
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

describe('TV reviews with season/episode targets', () => {
  it('allows a whole-series review and separates it from season reviews', async () => {
    await seedTvMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    // 整部剧集
    const whole = await agent.post('/review/24682/tv').send({
      rating: 3,
      message: 'Whole series review',
    });
    assert.strictEqual(whole.status, 201);

    // 第 1 季
    const season = await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'Season 1 was great',
      seasonNumber: 1,
    });
    assert.strictEqual(season.status, 201);

    // 整部列表只包含整部评论
    const wholeList = await agent.get('/review/24682/tv');
    assert.strictEqual(wholeList.body.reviewCount, 1);
    assert.strictEqual(
      wholeList.body.results[0].message,
      'Whole series review'
    );
    assert.strictEqual(wholeList.body.averageRating, 3);

    // 第 1 季列表只包含季评论
    const seasonList = await agent.get('/review/24682/tv?seasonNumber=1');
    assert.strictEqual(seasonList.body.reviewCount, 1);
    assert.strictEqual(
      seasonList.body.results[0].message,
      'Season 1 was great'
    );
    assert.strictEqual(seasonList.body.results[0].seasonNumber, 1);
    assert.strictEqual(seasonList.body.results[0].episodeNumber, null);
    assert.strictEqual(seasonList.body.averageRating, 4);
  });

  it('separates episode reviews from the season reviews', async () => {
    await seedTvMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'Season 1 review',
      seasonNumber: 1,
    });
    await agent.post('/review/24682/tv').send({
      rating: 5,
      message: 'Episode 3 review',
      seasonNumber: 1,
      episodeNumber: 3,
    });

    const seasonList = await agent.get('/review/24682/tv?seasonNumber=1');
    assert.strictEqual(seasonList.body.reviewCount, 1);
    assert.strictEqual(seasonList.body.results[0].message, 'Season 1 review');

    const episodeList = await agent.get(
      '/review/24682/tv?seasonNumber=1&episodeNumber=3'
    );
    assert.strictEqual(episodeList.body.reviewCount, 1);
    assert.strictEqual(episodeList.body.results[0].message, 'Episode 3 review');
    assert.strictEqual(episodeList.body.results[0].seasonNumber, 1);
    assert.strictEqual(episodeList.body.results[0].episodeNumber, 3);
    assert.strictEqual(episodeList.body.averageRating, 5);
  });

  it('upserts within the same target but keeps different targets separate', async () => {
    await seedTvMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'Season 1 first take',
      seasonNumber: 1,
    });
    const updated = await agent.post('/review/24682/tv').send({
      rating: 2,
      message: 'Season 1 second take',
      seasonNumber: 1,
    });
    assert.strictEqual(updated.status, 201);

    const seasonList = await agent.get('/review/24682/tv?seasonNumber=1');
    assert.strictEqual(seasonList.body.reviewCount, 1);
    assert.strictEqual(
      seasonList.body.results[0].message,
      'Season 1 second take'
    );

    const episodeList = await agent.get(
      '/review/24682/tv?seasonNumber=1&episodeNumber=2'
    );
    assert.strictEqual(episodeList.body.reviewCount, 0);
  });

  it('rejects an episode review without a season number', async () => {
    await seedTvMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'No season',
      episodeNumber: 3,
    });

    assert.strictEqual(res.status, 400);
  });

  it('rejects season targets on movie reviews', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Movie should not have a season',
      seasonNumber: 1,
    });

    assert.strictEqual(res.status, 400);
  });

  it('rejects a negative or zero season number', async () => {
    await seedTvMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'Bad season',
      seasonNumber: 0,
    });

    assert.strictEqual(res.status, 400);
  });
});

describe('Review editing and playback progress', () => {
  it('marks a review as edited after the content changes', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const create = await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'First take',
    });
    assert.strictEqual(create.status, 201);

    const list1 = await agent.get('/review/24681/movie');
    assert.strictEqual(list1.body.results[0].edited, false);

    // sqlite 时间戳秒级精度：跨秒编辑才能区分 createdAt/updatedAt
    await new Promise((r) => setTimeout(r, 1100));
    await agent.post('/review/24681/movie').send({
      rating: 5,
      message: 'Second take',
    });

    const list2 = await agent.get('/review/24681/movie');
    assert.strictEqual(list2.body.reviewCount, 1);
    assert.strictEqual(list2.body.results[0].message, 'Second take');
    assert.strictEqual(list2.body.results[0].edited, true);
  });

  it('does not mark as edited when the same content is resubmitted', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Same content',
    });

    // 跨秒后原样重发：内容未变不应触发保存，updatedAt 保持原值
    await new Promise((r) => setTimeout(r, 1100));
    await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Same content',
    });

    const list = await agent.get('/review/24681/movie');
    assert.strictEqual(list.body.results[0].edited, false);
  });

  it('includes author playback progress (movie completed)', async () => {
    await seedMedia();
    const userRepo = getRepository(User);
    const playbackRepo = getRepository(PlaybackEvent);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );
    await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'Nice movie',
    });

    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: 24681,
        mediaType: MediaType.MOVIE,
        completed: true,
      })
    );

    const list = await agent.get('/review/24681/movie');
    const review = list.body.results[0];
    assert.strictEqual(review.progress.status, 'completed');
  });

  it('includes author playback progress (tv watching episode)', async () => {
    await seedTvMedia();
    const userRepo = getRepository(User);
    const playbackRepo = getRepository(PlaybackEvent);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );
    await agent.post('/review/24682/tv').send({
      rating: 4,
      message: 'Great show',
    });

    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: 24682,
        mediaType: MediaType.TV,
        completed: false,
        seasonNumber: 2,
        episodeNumber: 5,
      })
    );

    const list = await agent.get('/review/24682/tv');
    const review = list.body.results[0];
    assert.strictEqual(review.progress.status, 'watching');
    assert.strictEqual(review.progress.seasonNumber, 2);
    assert.strictEqual(review.progress.episodeNumber, 5);
  });

  it('shows no progress when the author has no playback record', async () => {
    await seedMedia();
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    await agent.post('/review/24681/movie').send({
      rating: 4,
      message: 'No playback',
    });

    const list = await agent.get('/review/24681/movie');
    assert.strictEqual(list.body.results[0].progress, null);
  });
});
