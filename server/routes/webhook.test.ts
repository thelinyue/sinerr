import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import { User } from '@server/entity/User';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import webhookRoutes from './webhook';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRoutes);
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

describe('POST /webhook/emby', () => {
  it('records a completed playback.stop event for a known user', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.jellyfinUserId = 'jellyfin-user-1';
    await userRepo.save(friend);

    const res = await request(app).post('/webhook/emby').send({
      Event: 'playback.stop',
      UserId: 'jellyfin-user-1',
      ItemType: 'Movie',
      Name: 'Some Movie',
      Provider_tmdb: '12345',
      PlayedToCompletion: true,
    });

    assert.strictEqual(res.status, 204);

    const events = await getRepository(PlaybackEvent).find();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].tmdbId, 12345);
    assert.strictEqual(events[0].mediaType, 'movie');
    assert.strictEqual(events[0].completed, true);
    assert.strictEqual(events[0].user.id, friend.id);
  });

  it('records a playback.start event as not completed', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.jellyfinUserId = 'jellyfin-user-2';
    await userRepo.save(friend);

    const res = await request(app).post('/webhook/emby').send({
      Event: 'playback.start',
      UserId: 'jellyfin-user-2',
      ItemType: 'Episode',
      Name: 'Some Episode',
      Provider_tmdb: '9999',
      SeriesId: 'series-1',
      SeasonNumber: 1,
      EpisodeNumber: 3,
    });

    assert.strictEqual(res.status, 204);

    const events = await getRepository(PlaybackEvent).find();
    const event = events.find((e) => e.tmdbId === 9999);
    assert.ok(event);
    assert.strictEqual(event.completed, false);
    assert.strictEqual(event.mediaType, 'tv');
    assert.strictEqual(event.seasonNumber, 1);
    assert.strictEqual(event.episodeNumber, 3);
  });

  it('skips events for users not linked to Sinerr', async () => {
    const before = await getRepository(PlaybackEvent).count();

    const res = await request(app).post('/webhook/emby').send({
      Event: 'playback.stop',
      UserId: 'unknown-user',
      ItemType: 'Movie',
      Name: 'Unknown',
      Provider_tmdb: '5555',
    });

    assert.strictEqual(res.status, 204);
    const after = await getRepository(PlaybackEvent).count();
    assert.strictEqual(after, before);
  });

  it('skips events missing tmdbId', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.jellyfinUserId = 'jellyfin-user-3';
    await userRepo.save(friend);

    const before = await getRepository(PlaybackEvent).count();

    const res = await request(app).post('/webhook/emby').send({
      Event: 'playback.stop',
      UserId: 'jellyfin-user-3',
      ItemType: 'Movie',
      Name: 'No tmdb',
    });

    assert.strictEqual(res.status, 204);
    const after = await getRepository(PlaybackEvent).count();
    assert.strictEqual(after, before);
  });
});
