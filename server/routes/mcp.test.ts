import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { mcpTools } from '@server/lib/mcp';
import { getSettings } from '@server/lib/settings';
import mcpRoutes from '@server/routes/mcp';
import settingsRoutes from '@server/routes/settings';
import { setupTestDb } from '@server/test/db';
import { createTestApp, loginAs } from '@server/test/helpers';
import { Router, type Express } from 'express';
import request from 'supertest';

let app: Express;

before(async () => {
  app = createTestApp(
    Router().use('/settings', settingsRoutes).use('/mcp', mcpRoutes)
  );
});

setupTestDb();

describe('MCP endpoint (module 9)', () => {
  it('rejects requests when MCP is disabled', async () => {
    const settings = getSettings();
    const priorEnabled = settings.main.mcpEnabled;
    settings.main.mcpEnabled = false;
    try {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer some-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      assert.strictEqual(res.status, 401);
    } finally {
      settings.main.mcpEnabled = priorEnabled;
    }
  });

  it('rejects requests with the wrong token', async () => {
    const settings = getSettings();
    const priorEnabled = settings.main.mcpEnabled;
    const priorApiKey = settings.main.apiKey;
    settings.main.mcpEnabled = true;
    settings.main.apiKey = 'correct-token';
    try {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      assert.strictEqual(res.status, 401);
    } finally {
      settings.main.mcpEnabled = priorEnabled;
      settings.main.apiKey = priorApiKey;
    }
  });

  it('saves MCP settings via the admin settings endpoint', async () => {
    const agent = await loginAs(app, 'admin@sinerr.dev');
    const res = await agent.post('/settings/main').send({
      applicationTitle: 'Sinerr',
      mcpEnabled: true,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(getSettings().main.mcpEnabled, true);
  });

  it('registers the new read tools', async () => {
    const names = mcpTools.map((t) => t.name);
    for (const tool of ['get_subscription_feed', 'get_watched', 'get_report']) {
      assert.ok(names.includes(tool), `missing tool: ${tool}`);
    }
  });
});

describe('MCP write tools (module 9)', () => {
  it('request_media submits a movie request with correct payload', async () => {
    const requestMock = mock.method(MediaRequest, 'request', async () => ({
      id: 7,
      status: MediaRequestStatus.PENDING,
      media: { tmdbId: 998877, mediaType: 'movie' },
    }));
    try {
      const tool = mcpTools.find((t) => t.name === 'request_media');
      assert.ok(tool);
      const result = (await tool.handler({
        mediaType: 'movie',
        tmdbId: 998877,
      })) as { success: boolean; requestId: number };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.requestId, 7);

      const call = requestMock.mock.calls[0];
      assert.ok(call);
      const body = call.arguments[0] as {
        mediaType: string;
        mediaId: number;
        userId: number;
        seasons: unknown;
      };
      assert.strictEqual(body.mediaType, 'movie');
      assert.strictEqual(body.mediaId, 998877);
      assert.strictEqual(body.userId, 1); // 缺省操作人为管理员
    } finally {
      requestMock.mock.restore();
    }
  });

  it('request_media rejects an invalid media type', async () => {
    const tool = mcpTools.find((t) => t.name === 'request_media');
    assert.ok(tool);
    const result = (await tool.handler({
      mediaType: 'album',
      tmdbId: 1,
    })) as { success: boolean };
    assert.strictEqual(result.success, false);
  });

  it('update_request_status approves a pending request', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 554433,
        status: MediaStatus.PENDING,
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: admin,
      })
    );

    const tool = mcpTools.find((t) => t.name === 'update_request_status');
    assert.ok(tool);
    const result = (await tool.handler({
      requestId: request.id,
      status: 'approve',
    })) as { success: boolean; status: MediaRequestStatus };

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, MediaRequestStatus.APPROVED);

    const updated = await getRepository(MediaRequest).findOneOrFail({
      where: { id: request.id },
    });
    assert.strictEqual(updated.status, MediaRequestStatus.APPROVED);
  });

  it('delete_request removes a request', async () => {
    const userRepo = getRepository(User);
    const admin = await userRepo.findOneOrFail({
      where: { email: 'admin@sinerr.dev' },
    });
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.MOVIE,
        tmdbId: 554434,
        status: MediaStatus.PENDING,
      })
    );
    const request = await getRepository(MediaRequest).save(
      new MediaRequest({
        type: MediaType.MOVIE,
        status: MediaRequestStatus.PENDING,
        media,
        requestedBy: admin,
      })
    );

    const tool = mcpTools.find((t) => t.name === 'delete_request');
    assert.ok(tool);
    const result = (await tool.handler({
      requestId: request.id,
    })) as { success: boolean };

    assert.strictEqual(result.success, true);
    const remaining = await getRepository(MediaRequest).findOne({
      where: { id: request.id },
    });
    assert.strictEqual(remaining, null);
  });
});
