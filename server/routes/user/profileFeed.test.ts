import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import { User } from '@server/entity/User';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import type { Express } from 'express';

let app: Express;

before(async () => {
  app = createTestApp(userRoutes, '/user');
});

setupTestDb();

const getAllPlaybackActivityMock = mock.method(
  JellyfinAPI.prototype,
  'getAllUserPlaybackActivity',
  async () => []
).mock;
const getPlaybackEventsMock = mock.method(
  JellyfinAPI.prototype,
  'getUserPlaybackEvents',
  async () => []
).mock;

beforeEach(() => {
  getAllPlaybackActivityMock.resetCalls();
  getPlaybackEventsMock.resetCalls();
  getAllPlaybackActivityMock.mockImplementation(async () => []);
  getPlaybackEventsMock.mockImplementation(async () => []);
});

/** 给用户设置 jellyfinUserId 并创建关联媒体 + 剧集 + 评分 */
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

  const episodeRepo = getRepository(Episode);
  const eps = await episodeRepo.save([
    new Episode({
      media: tv,
      seasonNumber: 1,
      episodeNumber: 1,
      jellyfinEpisodeId: 'ep-1',
      addedAt: new Date(),
    }),
    new Episode({
      media: tv,
      seasonNumber: 1,
      episodeNumber: 2,
      jellyfinEpisodeId: 'ep-2',
      addedAt: new Date(),
    }),
    new Episode({
      media: tv,
      seasonNumber: 1,
      episodeNumber: 3,
      jellyfinEpisodeId: 'ep-3',
      addedAt: new Date(),
    }),
  ]);

  return { friend, movie, tv, eps };
}

describe('GET /user/:id/watched', () => {
  it('returns empty results when user has no jellyfinUserId', async () => {
    const { friend } = await seedUserAndMedia();
    friend.jellyfinUserId = null;
    await getRepository(User).save(friend);

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watched`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.results.length, 0);
  });

  it('maps movie + episode activity into watched grid', async () => {
    const { friend, movie, tv } = await seedUserAndMedia();

    getAllPlaybackActivityMock.mockImplementation(async (_userId, itemType) => {
      if (itemType === 'Movie') {
        return [
          {
            ItemId: 'movie-item-guid',
            ItemName: 'Some Movie',
            ItemType: 'Movie',
            PlayCount: 3,
            PlayDurationSeconds: 7200,
          },
        ];
      }
      return [
        {
          ItemId: 'ep-1',
          ItemName: 'Ep1',
          ItemType: 'Episode',
          PlayCount: 1,
          PlayDurationSeconds: 1200,
        },
        {
          ItemId: 'ep-2',
          ItemName: 'Ep2',
          ItemType: 'Episode',
          PlayCount: 1,
          PlayDurationSeconds: 1200,
        },
      ];
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watched`);

    assert.strictEqual(res.status, 200);
    const movieItem = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === movie.tmdbId
    );
    assert.ok(movieItem);
    assert.strictEqual(movieItem.mediaType, 'movie');
    assert.strictEqual(movieItem.playCount, 3);

    const tvItem = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === tv.tmdbId
    );
    assert.ok(tvItem);
    assert.strictEqual(tvItem.mediaType, 'tv');
    assert.strictEqual(tvItem.watchedCount, 2);
    assert.strictEqual(tvItem.totalCount, 3);
    assert.strictEqual(tvItem.watchedPercent, 67);
    assert.strictEqual(tvItem.completed, false);
  });

  it('includes the users local rating on watched items', async () => {
    const { friend, movie } = await seedUserAndMedia();
    const reviewRepo = getRepository(MediaReview);
    await reviewRepo.save(
      new MediaReview({
        media: movie,
        user: friend,
        rating: 4,
        message: 'Great film',
      })
    );

    getAllPlaybackActivityMock.mockImplementation(async (_userId, itemType) => {
      if (itemType === 'Movie') {
        return [
          {
            ItemId: 'movie-item-guid',
            ItemName: 'M',
            ItemType: 'Movie',
            PlayCount: 1,
            PlayDurationSeconds: 3600,
          },
        ];
      }
      return [];
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watched`);

    const movieItem = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === movie.tmdbId
    );
    assert.strictEqual(movieItem.rating, 4);
  });

  it('falls back to local PlaybackEvent when plugin returns nothing', async () => {
    const { friend, movie } = await seedUserAndMedia();

    getAllPlaybackActivityMock.mockImplementation(async () => []);

    const playbackRepo = getRepository(PlaybackEvent);
    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: movie.tmdbId,
        mediaType: MediaType.MOVIE,
        completed: true,
        durationSeconds: 5400,
      })
    );

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/watched`);

    const movieItem = res.body.results.find(
      (r: { tmdbId: number }) => r.tmdbId === movie.tmdbId
    );
    assert.ok(movieItem);
    assert.strictEqual(movieItem.completed, true);
  });

  it('enforces permission', async () => {
    await seedUserAndMedia();
    // friend 无 MANAGE_USERS/MANAGE_REQUESTS，不可查看他人（admin）的已看
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });
    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/watched`);

    assert.strictEqual(res.status, 403);
  });
});

describe('GET /user/:id/report', () => {
  it('returns yearly aggregates from plugin events', async () => {
    const { friend, movie } = await seedUserAndMedia();

    getPlaybackEventsMock.mockImplementation(async () => [
      {
        ItemId: 'movie-item-guid',
        ItemType: 'Movie',
        PlayDurationSeconds: 3600,
        DateCreated: '2026-01-10T12:00:00Z',
      },
      {
        ItemId: 'movie-item-guid',
        ItemType: 'Movie',
        PlayDurationSeconds: 1800,
        DateCreated: '2026-02-05T12:00:00Z',
      },
      {
        ItemId: 'ep-1',
        ItemType: 'Episode',
        PlayDurationSeconds: 1200,
        DateCreated: '2026-01-15T12:00:00Z',
      },
      {
        ItemId: 'ep-2',
        ItemType: 'Episode',
        PlayDurationSeconds: 1200,
        DateCreated: '2026-01-20T12:00:00Z',
      },
    ]);

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/report?year=2026`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.year, 2026);
    assert.strictEqual(res.body.totalSeconds, 7800);
    assert.strictEqual(res.body.playCount, 4);
    assert.strictEqual(res.body.watchedTitles, 2);
    assert.strictEqual(res.body.movieTitles, 1);
    assert.strictEqual(res.body.tvTitles, 1);

    // 金榜 TOP：电影时长 5400 > 剧集 2400
    assert.strictEqual(res.body.topItems.length, 2);
    assert.strictEqual(res.body.topItems[0].tmdbId, movie.tmdbId);
    assert.strictEqual(res.body.topItems[0].playDurationSeconds, 5400);

    // 月份下钻：1 月 3 次，2 月 1 次
    const jan = res.body.months.find((m: { month: number }) => m.month === 1);
    const feb = res.body.months.find((m: { month: number }) => m.month === 2);
    assert.ok(jan);
    assert.strictEqual(jan.playCount, 3);
    assert.strictEqual(jan.titleCount, 2);
    assert.ok(feb);
    assert.strictEqual(feb.playCount, 1);
  });

  it('returns empty report without jellyfinUserId', async () => {
    const { friend } = await seedUserAndMedia();
    friend.jellyfinUserId = null;
    await getRepository(User).save(friend);

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/report?year=2026`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalSeconds, 0);
    assert.strictEqual(res.body.watchedTitles, 0);
  });

  it('falls back to local PlaybackEvent when plugin is unavailable', async () => {
    const { friend, movie } = await seedUserAndMedia();
    // 无 jellyfinUserId（跳过插件），但有本地 webhook 播放记录
    friend.jellyfinUserId = null;
    await getRepository(User).save(friend);
    getPlaybackEventsMock.mockImplementation(async () => []);

    const now = new Date();
    await getRepository(PlaybackEvent).save(
      new PlaybackEvent({
        user: friend,
        tmdbId: movie.tmdbId,
        mediaType: MediaType.MOVIE,
        completed: true,
        durationSeconds: 3600,
        createdAt: new Date(now.getFullYear(), 0, 15),
      })
    );

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/report?year=${now.getFullYear()}`
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalSeconds, 3600);
    assert.strictEqual(res.body.watchedTitles, 1);
    assert.strictEqual(res.body.movieTitles, 1);
    assert.strictEqual(res.body.playCount, 1);
  });
});

describe('GET /user/:id/activity', () => {
  it('merges watch events and request events into a timeline', async () => {
    const { friend, movie } = await seedUserAndMedia();

    const playbackRepo = getRepository(PlaybackEvent);
    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: movie.tmdbId,
        mediaType: MediaType.MOVIE,
        completed: true,
        durationSeconds: 5400,
      })
    );

    const requestRepo = getRepository(MediaRequest);
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media: movie,
        requestedBy: friend,
      })
    );

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/activity?take=10`);

    assert.strictEqual(res.status, 200);
    const types = res.body.results.map((r: { type: string }) => r.type);
    assert.ok(types.includes('watch'));
    assert.ok(types.includes('request'));
    // 时间倒序
    const times = res.body.results.map((r: { createdAt: string }) =>
      new Date(r.createdAt).getTime()
    );
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i - 1] >= times[i], `expected desc order, got ${times}`);
    }
  });

  it('filters timeline by type', async () => {
    const { friend, movie } = await seedUserAndMedia();

    const playbackRepo = getRepository(PlaybackEvent);
    await playbackRepo.save(
      new PlaybackEvent({
        user: friend,
        tmdbId: movie.tmdbId,
        mediaType: MediaType.MOVIE,
        completed: true,
        durationSeconds: 5400,
      })
    );

    const requestRepo = getRepository(MediaRequest);
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media: movie,
        requestedBy: friend,
      })
    );

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(
      `/user/${friend.id}/activity?take=10&type=watch`
    );

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length > 0);
    for (const item of res.body.results) {
      assert.strictEqual(item.type, 'watch');
    }
  });

  it('enforces permission', async () => {
    await seedUserAndMedia();
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });
    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/activity`);
    assert.strictEqual(res.status, 403);
  });
});
