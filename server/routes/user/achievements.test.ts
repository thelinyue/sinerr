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
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import type { Express } from 'express';

let app: Express;

before(async () => {
  app = createTestApp(userRoutes, '/user');
});

setupTestDb();

describe('GET /user/:id/achievements', () => {
  it('reports no earned badges for a new user', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.results.length >= 6);
    assert.ok(res.body.results.every((b: { earned: boolean }) => !b.earned));
  });

  it('reports earned badges when thresholds are met', async () => {
    const userRepo = getRepository(User);
    const mediaRepo = getRepository(Media);
    const requestRepo = getRepository(MediaRequest);
    const voteRepo = getRepository(RequestVote);

    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    // friend 提交 10 个请求
    for (let i = 0; i < 10; i++) {
      const media = await mediaRepo.save(
        new Media({
          mediaType: MediaType.MOVIE,
          tmdbId: 30000 + i,
          status: MediaStatus.UNKNOWN,
        })
      );
      const request = await requestRepo.save(
        new MediaRequest({
          type: MediaType.MOVIE,
          status: MediaRequestStatus.PENDING,
          media,
          requestedBy: friend,
        })
      );
      // admin 给每个请求点赞 => friend 获 10 赞
      await voteRepo.save(new RequestVote({ request, user: admin }));
    }

    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
    const requester10 = res.body.results.find(
      (b: { id: string }) => b.id === 'requester10'
    );
    assert.ok(requester10.earned);
    assert.strictEqual(requester10.current, 10);

    const voted5 = res.body.results.find(
      (b: { id: string }) => b.id === 'voted5'
    );
    assert.ok(voted5.earned);
    assert.strictEqual(voted5.current, 10);
  });

  it('forbids viewing another user achievements without permission', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${admin.id}/achievements`);

    assert.strictEqual(res.status, 403);
  });

  it('allows a user to view their own achievements', async () => {
    const userRepo = getRepository(User);
    const friend = await userRepo.findOneOrFail({
      where: { email: 'friend@sinerr.dev' },
    });

    const agent = await loginAs(app, 'friend@sinerr.dev', 'test1234');
    const res = await agent.get(`/user/${friend.id}/achievements`);

    assert.strictEqual(res.status, 200);
  });
});
