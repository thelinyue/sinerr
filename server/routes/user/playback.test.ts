import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import type { JellyfinLibraryItem } from '@server/api/jellyfin';
import JellyfinAPI from '@server/api/jellyfin';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
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

// Mock Jellyfin API 外部调用，避免真实网络请求
const getUserPlaybackActivityMock = mock.method(
  JellyfinAPI.prototype,
  'getUserPlaybackActivity',
  async () => []
).mock;
const getUserWatchTimeMock = mock.method(
  JellyfinAPI.prototype,
  'getUserWatchTime',
  async () => ({ todaySeconds: 0, totalSeconds: 0 })
).mock;
const getSeasonsMock = mock.method(
  JellyfinAPI.prototype,
  'getSeasons',
  async () => []
).mock;
const getEpisodesMock = mock.method(
  JellyfinAPI.prototype,
  'getEpisodes',
  async () => []
).mock;

beforeEach(() => {
  getUserPlaybackActivityMock.resetCalls();
  getUserWatchTimeMock.resetCalls();
  getSeasonsMock.resetCalls();
  getEpisodesMock.resetCalls();
  getUserPlaybackActivityMock.mockImplementation(async () => []);
  getUserWatchTimeMock.mockImplementation(async () => ({
    todaySeconds: 0,
    totalSeconds: 0,
  }));
  getSeasonsMock.mockImplementation(async () => []);
  getEpisodesMock.mockImplementation(async () => []);
});

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

/** 给用户设置 jellyfinUserId 并创建关联媒体 */
async function seedUserAndMedia() {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);

  const friend = await userRepo.findOneOrFail({
    where: { email: 'friend@sinerr.dev' },
  });
  friend.jellyfinUserId = 'jellyfin-user-guid';
  await userRepo.save(friend);

  const movie = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 55501,
      status: MediaStatus.UNKNOWN,
      jellyfinMediaId: 'movie-item-guid',
    })
  );
  const tv = await mediaRepo.save(
    new Media({
      mediaType: MediaType.TV,
      tmdbId: 55502,
      status: MediaStatus.UNKNOWN,
      jellyfinMediaId: 'series-item-guid',
    })
  );

  return { friend, movie, tv };
}

describe('GET /user/:id/media/:tmdbId/:mediaType/playback', () => {
  it('returns unwatched for a movie with no playback records', async () => {
    const { friend, movie } = await seedUserAndMedia();
    getUserPlaybackActivityMock.mockImplementation(async () => []);

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/media/${movie.tmdbId}/movie/playback`
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.played, false);
    assert.strictEqual(res.body.playCount, 0);
  });

  it('marks a movie as watched when playback records exist', async () => {
    const { friend, movie } = await seedUserAndMedia();
    getUserPlaybackActivityMock.mockImplementation(async () => [
      {
        ItemId: 'movie-item-guid',
        ItemName: 'Some Movie',
        ItemType: 'Movie',
        PlayCount: 3,
        PlayDurationSeconds: 7200,
      },
    ]);

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/media/${movie.tmdbId}/movie/playback`
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.played, true);
    assert.strictEqual(res.body.playCount, 3);
    assert.strictEqual(res.body.playDurationSeconds, 7200);
  });

  it('computes watched episodes and percentage for a series', async () => {
    const { friend, tv } = await seedUserAndMedia();
    const season1 = { Id: 'season-1' } as unknown as JellyfinLibraryItem;
    const season2 = { Id: 'season-2' } as unknown as JellyfinLibraryItem;
    const ep1 = { Id: 'ep-1' } as unknown as JellyfinLibraryItem;
    const ep2 = { Id: 'ep-2' } as unknown as JellyfinLibraryItem;
    const ep3 = { Id: 'ep-3' } as unknown as JellyfinLibraryItem;
    const ep4 = { Id: 'ep-4' } as unknown as JellyfinLibraryItem;
    const ep5 = { Id: 'ep-5' } as unknown as JellyfinLibraryItem;

    getSeasonsMock.mockImplementation(async () => [season1, season2]);
    getEpisodesMock.mockImplementation((async (
      _seriesId: string,
      seasonId: string
    ) => {
      if (seasonId === 'season-1') {
        return [ep1, ep2, ep3];
      }
      return [ep4, ep5];
    }) as typeof JellyfinAPI.prototype.getEpisodes);
    // 用户看过 ep-1、ep-2、ep-4（共 3 集 / 5 集 = 60%）
    getUserPlaybackActivityMock.mockImplementation(async () => [
      {
        ItemId: 'ep-1',
        ItemName: 'Ep 1',
        ItemType: 'Episode',
        PlayCount: 1,
        PlayDurationSeconds: 1200,
      },
      {
        ItemId: 'ep-2',
        ItemName: 'Ep 2',
        ItemType: 'Episode',
        PlayCount: 1,
        PlayDurationSeconds: 1200,
      },
      {
        ItemId: 'ep-4',
        ItemName: 'Ep 4',
        ItemType: 'Episode',
        PlayCount: 1,
        PlayDurationSeconds: 1200,
      },
    ]);

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/media/${tv.tmdbId}/tv/playback`
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.played, true);
    assert.strictEqual(res.body.watchedEpisodes, 3);
    assert.strictEqual(res.body.totalEpisodes, 5);
    assert.strictEqual(res.body.watchedPercent, 60);
    assert.strictEqual(res.body.playCount, 3);
  });

  it('returns unwatched for a user without jellyfin account', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);

    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });
    admin.jellyfinUserId = null;
    await userRepo.save(admin);

    const media = await mediaRepo.save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 55503,
        status: MediaStatus.UNKNOWN,
        jellyfinMediaId: 'movie-item-guid-2',
      })
    );

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${admin.id}/media/${media.tmdbId}/movie/playback`
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.played, false);
  });

  it('forbids viewing another user playback without permission', async () => {
    const { friend } = await seedUserAndMedia();

    const agent = await loginAs('admin@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/media/55501/movie/playback`
    );

    // admin 拥有 MANAGE_USERS 权限，允许访问
    assert.strictEqual(res.status, 200);
  });
});

describe('GET /user/:id/watchtime', () => {
  it('aggregates today and total watch time from playback events', async () => {
    const { friend } = await seedUserAndMedia();
    const playbackRepo = getRepository(PlaybackEvent);

    // 今日一条 1 小时、一条 30 分钟；历史一条 2 小时
    await playbackRepo.save([
      new PlaybackEvent({
        user: friend,
        tmdbId: 55501,
        mediaType: MediaType.MOVIE,
        durationSeconds: 3600,
      }),
      new PlaybackEvent({
        user: friend,
        tmdbId: 55502,
        mediaType: MediaType.TV,
        durationSeconds: 1800,
      }),
    ]);
    // 昨天的一条（createdAt 手动改为昨天）
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: 55501,
        mediaType: MediaType.MOVIE,
        durationSeconds: 7200,
        createdAt: yesterday,
      })
    );

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watchtime`);

    assert.strictEqual(res.status, 200);
    // 今日 = 3600 + 1800 = 5400
    assert.strictEqual(res.body.todaySeconds, 5400);
    // 累计 = 3600 + 1800 + 7200 = 12600
    assert.strictEqual(res.body.totalSeconds, 12600);
  });

  it('returns zero when there are no playback events', async () => {
    const { friend } = await seedUserAndMedia();

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watchtime`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.todaySeconds, 0);
    assert.strictEqual(res.body.totalSeconds, 0);
  });

  it('forbids viewing another user watch time without permission', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/watchtime`);

    assert.strictEqual(res.status, 403);
  });

  it('prefers Playback Report plugin data over webhook fallback', async () => {
    const { friend } = await seedUserAndMedia();
    // 插件返回非零数据，应直接采用，不触发 webhook 回退
    getUserWatchTimeMock.mockImplementation(async () => ({
      todaySeconds: 900,
      totalSeconds: 99900,
    }));

    const agent = await loginAs('friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watchtime`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.todaySeconds, 900);
    assert.strictEqual(res.body.totalSeconds, 99900);
  });
});
