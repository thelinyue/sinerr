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
import { createTestApp, loginAs } from '@server/test/helpers';
import type { Express } from 'express';
import voteRoutes from './vote';

let app: Express;

before(async () => {
  app = createTestApp(voteRoutes, '/request');
});

setupTestDb();

/** 授予/移除 VOTE 权限后登录，用于构造不同权限场景 */
async function loginWithPermissions(email: string, permissions: number) {
  const userRepository = getRepository(User);
  const user = await userRepository.findOneOrFail({ where: { email } });
  user.permissions = permissions;
  await userRepository.save(user);
  return loginAs(app, email, 'test1234');
}

async function seedRequest(requestedByEmail = 'admin@sinerr.dev') {
  const userRepo = getRepository(User);
  const mediaRepo = getRepository(Media);
  const requestRepo = getRepository(MediaRequest);

  const requestedBy = await userRepo.findOneOrFail({
    where: { email: requestedByEmail },
  });

  const media = await mediaRepo.save(
    new Media({
      mediaType: MediaType.MOVIE,
      tmdbId: 24680,
      status: MediaStatus.UNKNOWN,
    })
  );

  const created = await requestRepo.save(
    new MediaRequest({
      type: MediaType.MOVIE,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy,
    })
  );

  return requestRepo.findOneOrFail({
    where: { id: created.id },
    relations: { requestedBy: true, modifiedBy: true },
  });
}

describe('POST /request/:requestId/vote', () => {
  it('allows a user with the VOTE permission to vote on another user request', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');

    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );
    const res = await agent.post(`/request/${mediaRequest.id}/vote`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.voteCount, 1);
    assert.strictEqual(res.body.userVoted, true);
  });

  it('is idempotent when voting twice', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const first = await agent.post(`/request/${mediaRequest.id}/vote`);
    assert.strictEqual(first.status, 201);

    const second = await agent.post(`/request/${mediaRequest.id}/vote`);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.voteCount, 1);
    assert.strictEqual(second.body.userVoted, true);
  });

  it('rejects voting on your own request', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'admin@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const res = await agent.post(`/request/${mediaRequest.id}/vote`);

    assert.strictEqual(res.status, 400);
  });

  it('rejects voting without the VOTE permission', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.post(`/request/${mediaRequest.id}/vote`);

    assert.strictEqual(res.status, 403);
  });

  it('returns 404 for a non-existent request', async () => {
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const res = await agent.post('/request/99999999/vote');

    assert.strictEqual(res.status, 404);
  });
});

describe('DELETE /request/:requestId/vote', () => {
  it('removes an existing vote', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    await agent.post(`/request/${mediaRequest.id}/vote`);
    const res = await agent.delete(`/request/${mediaRequest.id}/vote`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.voteCount, 0);
    assert.strictEqual(res.body.userVoted, false);
  });

  it('is idempotent when no vote exists', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );

    const res = await agent.delete(`/request/${mediaRequest.id}/vote`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.voteCount, 0);
    assert.strictEqual(res.body.userVoted, false);
  });
});

describe('GET /request/:requestId/votes', () => {
  it('returns the voter list to the request owner', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const voterAgent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );
    await voterAgent.post(`/request/${mediaRequest.id}/vote`);

    const ownerAgent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await ownerAgent.get(`/request/${mediaRequest.id}/votes`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.voteCount, 1);
    assert.strictEqual(res.body.userVoted, false);
    assert.strictEqual(res.body.results.length, 1);
    assert.strictEqual(res.body.results[0].displayName, 'friend');
  });

  it('returns the voter list to a user with REQUEST_VIEW permission', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const voterAgent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.VOTE
    );
    await voterAgent.post(`/request/${mediaRequest.id}/vote`);

    // 使用独立的 REQUEST_VIEW 用户查看，确保与投票者身份解耦
    const userRepository = getRepository(User);
    const viewer = new User({
      email: 'viewer@sinerr.dev',
      username: 'viewer',
      password: '$2b$12$Z5V2P5HZgmx4/AnWFMZN1.aD5AM1NucNi.mhNTSQ9oVtmdzu7Le/a',
      permissions: Permission.REQUEST | Permission.REQUEST_VIEW,
      avatar: 'https://example.com/avatar.png',
    });
    await userRepository.save(viewer);

    const viewerAgent = await loginAs(app, 'viewer@sinerr.dev', 'test1234');
    const res = await viewerAgent.get(`/request/${mediaRequest.id}/votes`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.voteCount, 1);
    assert.strictEqual(res.body.userVoted, false);
    assert.strictEqual(res.body.results.length, 1);
  });

  it('forbids a non-owner without REQUEST_VIEW from viewing the voter list', async () => {
    const mediaRequest = await seedRequest('admin@sinerr.dev');
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );

    const res = await agent.get(`/request/${mediaRequest.id}/votes`);

    assert.strictEqual(res.status, 403);
  });

  it('returns 404 for a non-existent request', async () => {
    const agent = await loginAs(app, 'admin@sinerr.dev', 'test1234');
    const res = await agent.get('/request/99999999/votes');
    assert.strictEqual(res.status, 404);
  });
});
