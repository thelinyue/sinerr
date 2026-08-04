import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
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

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
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

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 2);
  });

  it('forbids viewing another user recently watched without permission', async () => {
    const admin = await getRepository(User).findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/recently-watched`);

    assert.strictEqual(res.status, 403);
  });

  it('returns an empty list for a user with no playback records', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.results, []);
  });

  it('dedupes duplicate episodes and movies keeping the most recent', async () => {
    const userRepo = getRepository(User);
    const playbackRepo = getRepository(PlaybackEvent);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const dedupeUser = new User();
    dedupeUser.username = 'dedupe';
    dedupeUser.email = 'dedupe@sinerr.dev';
    dedupeUser.password = admin.password;
    dedupeUser.permissions = 32;
    dedupeUser.avatar = '/avatarproxy/default';
    await userRepo.save(dedupeUser);

    await playbackRepo.save([
      new PlaybackEvent({
        user: dedupeUser,
        tmdbId: 55501,
        mediaType: MediaType.TV,
        completed: false,
        seasonNumber: 1,
        episodeNumber: 5,
        durationSeconds: 1000,
      }),
      new PlaybackEvent({
        user: dedupeUser,
        tmdbId: 55501,
        mediaType: MediaType.TV,
        completed: false,
        seasonNumber: 1,
        episodeNumber: 5,
        durationSeconds: 2000,
      }),
      new PlaybackEvent({
        user: dedupeUser,
        tmdbId: 55501,
        mediaType: MediaType.TV,
        completed: true,
        seasonNumber: 1,
        episodeNumber: 6,
        durationSeconds: 3000,
      }),
      new PlaybackEvent({
        user: dedupeUser,
        tmdbId: 55502,
        mediaType: MediaType.MOVIE,
        completed: true,
        durationSeconds: 4000,
      }),
      new PlaybackEvent({
        user: dedupeUser,
        tmdbId: 55502,
        mediaType: MediaType.MOVIE,
        completed: false,
        durationSeconds: 5000,
      }),
    ]);

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${dedupeUser.id}/recently-watched`);

    assert.strictEqual(res.status, 200);
    const results = res.body.results as {
      tmdbId: number;
      mediaType: string;
      seasonNumber: number | null;
      episodeNumber: number | null;
    }[];

    // 剧集：S1E5 重复只保留一条，S1E6 保留 → 共 2 条
    const tv = results.filter((r) => r.tmdbId === 55501);
    assert.strictEqual(tv.length, 2);
    assert.ok(
      tv.some((r) => r.seasonNumber === 1 && r.episodeNumber === 5) &&
        tv.some((r) => r.seasonNumber === 1 && r.episodeNumber === 6)
    );

    // 电影：重复只保留一条
    const movie = results.filter((r) => r.tmdbId === 55502);
    assert.strictEqual(movie.length, 1);
  });
});
