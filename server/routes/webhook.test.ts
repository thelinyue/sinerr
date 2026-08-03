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

  it('records an Emby nested-format playback.start using tmdbId from Item.Path', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.jellyfinUserId = 'emby-user-1';
    await userRepo.save(friend);

    const res = await request(app)
      .post('/webhook/emby')
      .send({
        Event: 'playback.start',
        User: { Id: 'emby-user-1', Name: 'linyue' },
        Item: {
          Id: '596533',
          Type: 'Episode',
          IndexNumber: 23,
          ParentIndexNumber: 1,
          SeriesName: '野狗骨头',
          ProviderIds: {},
          Path: '/strm/115/video/国产剧/野狗骨头 (2026) {tmdb-291392}/Season 1/野狗骨头 S01E23.strm',
        },
        PlaybackInfo: {
          MediaSource: { RunTimeTicks: 27211200000 },
          PositionTicks: 0,
        },
        Title: 'linyue 在 iPhone 上开始播放 野狗骨头',
      });

    assert.strictEqual(res.status, 204);

    const events = await getRepository(PlaybackEvent).find();
    const event = events.find((e) => e.tmdbId === 291392);
    assert.ok(event, 'expected playback event with tmdbId 291392');
    assert.strictEqual(event.mediaType, 'tv');
    assert.strictEqual(event.seasonNumber, 1);
    assert.strictEqual(event.episodeNumber, 23);
    assert.strictEqual(event.completed, false);
    assert.strictEqual(event.user.id, friend.id);
  });

  it('records an Emby nested-format playback.stop as completed via position/runtime', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.jellyfinUserId = 'emby-user-2';
    await userRepo.save(friend);

    const res = await request(app)
      .post('/webhook/emby')
      .send({
        Event: 'playback.stop',
        User: { Id: 'emby-user-2', Name: 'linyue' },
        Item: {
          Id: '596533',
          Type: 'Episode',
          IndexNumber: 23,
          ParentIndexNumber: 1,
          ProviderIds: { Tmdb: '291392' },
        },
        PlaybackInfo: {
          MediaSource: { RunTimeTicks: 27211200000 },
          PositionTicks: 25000000000, // ~92% 视为看完
        },
      });

    assert.strictEqual(res.status, 204);

    const events = await getRepository(PlaybackEvent).find();
    const event = events.find((e) => e.tmdbId === 291392);
    assert.ok(event);
    assert.strictEqual(event.completed, true);
  });
});
