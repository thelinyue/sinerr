import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

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
import {
  notifyEpisodeUpdated,
  resetEpisodeNotificationState,
} from '@server/lib/episodeNotification';
import notificationManager, { Notification } from '@server/lib/notifications';
import { Permission } from '@server/lib/permissions';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import type { Express } from 'express';

let app: Express;

before(async () => {
  app = createTestApp(userRoutes, '/user');
});

setupTestDb();

const sendNotificationMock = mock.method(
  notificationManager,
  'sendNotification',
  () => undefined
).mock;

beforeEach(() => {
  sendNotificationMock.resetCalls();
  resetEpisodeNotificationState();
});

async function seedFollowedMedia() {
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
      mediaType: MediaType.TV,
      tmdbId: 66601,
      status: MediaStatus.AVAILABLE,
      mediaAddedAt: new Date(),
      jellyfinMediaId: 'series-guid',
    })
  );
  const request = await requestRepo.save(
    new MediaRequest({
      type: MediaType.TV,
      status: MediaRequestStatus.APPROVED,
      media,
      requestedBy: admin,
    })
  );
  await voteRepo.save(new RequestVote({ request, user: friend }));

  return { admin, friend, media };
}

describe('notifyEpisodeUpdated (F1)', () => {
  const stubTitle = async () => ({ title: 'Test Series', image: '' });

  it('notifies requesters and voters (deduped) once per media', async () => {
    const { media } = await seedFollowedMedia();

    await notifyEpisodeUpdated(
      {
        mediaId: media.id,
        tmdbId: media.tmdbId,
        mediaType: MediaType.TV,
        newEpisodes: [
          { seasonNumber: 1, episodeNumber: 4, addedAt: new Date() },
          { seasonNumber: 1, episodeNumber: 5, addedAt: new Date() },
        ],
      },
      { getTitle: stubTitle }
    );

    // admin（请求人）+ friend（声援人）各一条
    assert.strictEqual(sendNotificationMock.callCount(), 2);
    const types = sendNotificationMock.calls.map((call) => call.arguments[0]);
    assert.ok(types.every((t) => t === Notification.EPISODE_UPDATED));
  });

  it('respects the per-media daily anti-spam limit', async () => {
    const { media } = await seedFollowedMedia();

    await notifyEpisodeUpdated(
      {
        mediaId: media.id,
        tmdbId: media.tmdbId,
        mediaType: MediaType.TV,
        newEpisodes: [
          { seasonNumber: 1, episodeNumber: 4, addedAt: new Date() },
        ],
      },
      { getTitle: stubTitle }
    );
    const firstCount = sendNotificationMock.callCount();
    assert.ok(firstCount > 0);

    // 同剧第二次（<24h）不再发
    await notifyEpisodeUpdated(
      {
        mediaId: media.id,
        tmdbId: media.tmdbId,
        mediaType: MediaType.TV,
        newEpisodes: [
          { seasonNumber: 1, episodeNumber: 5, addedAt: new Date() },
        ],
      },
      { getTitle: stubTitle }
    );
    assert.strictEqual(sendNotificationMock.callCount(), firstCount);
  });
});

describe('GET /user/:id/following-updates (F2)', () => {
  it('returns the followed media with update state for the owner', async () => {
    const { admin, media } = await seedFollowedMedia();

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/following-updates`);

    assert.strictEqual(res.status, 200);
    const item = res.body.results.find(
      (r: { media: { tmdbId: number } }) => r.media.tmdbId === media.tmdbId
    );
    assert.ok(item);
  });

  it('forbids viewing without REQUEST_VIEW', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    friend.permissions = Permission.REQUEST;
    await userRepo.save(friend);

    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/following-updates`);
    assert.strictEqual(res.status, 403);
  });
});
