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
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginWithPermissions } from '@server/test/helpers';
import type { Express } from 'express';
import mediaRoutes from './media';

let app: Express;

before(async () => {
  app = createTestApp(mediaRoutes, '/media');
});

setupTestDb();

async function seedMediaWithRequest() {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);
  const requestRepo = getRepository(MediaRequest);

  const admin = await userRepo.findOneOrFail({
    where: { email: 'admin@sinerr.dev' },
  });

  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 77701,
      status: MediaStatus.AVAILABLE,
    })
  );
  await requestRepo.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy: admin,
    })
  );

  return { admin, media };
}

describe('POST /media/:tmdbId/:mediaType/vote', () => {
  it('votes on the media active request', async () => {
    const { media } = await seedMediaWithRequest();
    const agent = await loginWithPermissions(
      app,
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const res = await agent.post(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.voteCount, 1);
    assert.strictEqual(res.body.userVoted, true);
  });

  it('is idempotent on repeat vote', async () => {
    const { media } = await seedMediaWithRequest();
    const agent = await loginWithPermissions(
      app,
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    await agent.post(`/media/${media.tmdbId}/movie/vote`);
    const res = await agent.post(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.body.voteCount, 1);
  });

  it('rejects voting on your own media request', async () => {
    const { media } = await seedMediaWithRequest();
    const agent = await loginWithPermissions(
      app,
      'admin@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const res = await agent.post(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.status, 400);
  });

  it('rejects voting without the VOTE permission', async () => {
    const { media } = await seedMediaWithRequest();
    const agent = await loginWithPermissions(
      app,
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.status, 403);
  });

  it('dedupes vote count across multiple requests of the same media', async () => {
    const { admin, media } = await seedMediaWithRequest();
    const userRepo = getRepository(User);
    const requestRepo = getRepository(MediaRequest);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    // 第二个用户也请求了同一媒体（产生两条请求）
    await requestRepo.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: friend,
      })
    );

    const agent = await loginWithPermissions(
      app,
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );
    // friend 给 admin 的请求点赞
    const adminRequest = await requestRepo.findOneOrFail({
      where: { media: { id: media.id }, requestedBy: { id: admin.id } },
    });
    const res = await agent.post(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.body.voteCount, 1);
    assert.ok(adminRequest.id);
  });

  it('removes the vote on DELETE', async () => {
    const { media } = await seedMediaWithRequest();
    const agent = await loginWithPermissions(
      app,
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    await agent.post(`/media/${media.tmdbId}/movie/vote`);
    const res = await agent.delete(`/media/${media.tmdbId}/movie/vote`);
    assert.strictEqual(res.body.voteCount, 0);
    assert.strictEqual(res.body.userVoted, false);
  });
});
