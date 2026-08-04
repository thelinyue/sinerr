import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import discoverRoutes from './discover';

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
  app.use('/discover', discoverRoutes);
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

async function loginWithPermissions(email: string, permissions: number) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({ where: { email } });
    user.permissions = permissions;
    await userRepo.save(user);
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

/** 造媒体：mediaAddedAt 与可选新增单集 */
async function seedMedia(opts: {
  tmdbId: number;
  mediaType?: MediaType;
  mediaAddedAt?: Date;
  status?: MediaStatus;
  episodes?: { seasonNumber: number; episodeNumber: number; addedAt: Date }[];
}) {
  const mediaRepo = getRepository(Media);
  const episodeRepo = getRepository(Episode);
  const media = await mediaRepo.save(
    new Media({
      mediaType: opts.mediaType ?? MediaType.MOVIE,
      tmdbId: opts.tmdbId,
      status: opts.status ?? MediaStatus.AVAILABLE,
      mediaAddedAt: opts.mediaAddedAt,
    })
  );
  for (const ep of opts.episodes ?? []) {
    await episodeRepo.save(
      new Episode({
        media,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        addedAt: ep.addedAt,
      })
    );
  }
  return media;
}

const NOW = Date.now();
const days = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

describe('GET /discover/recentlyadded', () => {
  it('requires RECENT_VIEW permission', async () => {
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST
    );
    const res = await agent.get('/discover/recentlyadded');
    assert.strictEqual(res.status, 403);
  });

  it('returns newly added movie (mediaAddedAt in window, no episodes)', async () => {
    await seedMedia({ tmdbId: 1, mediaAddedAt: days(1) });
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.RECENT_VIEW
    );
    const res = await agent.get('/discover/recentlyadded?days=7');
    assert.strictEqual(res.status, 200);
    const item = res.body.results.find(
      (r: { media: { tmdbId: number } }) => r.media.tmdbId === 1
    );
    assert.ok(item);
    assert.strictEqual(item.episodeCount, 0);
    assert.deepStrictEqual(item.newEpisodes, []);
  });

  it('returns series with recently added episodes and their detail', async () => {
    await seedMedia({
      tmdbId: 2,
      mediaType: MediaType.TV,
      mediaAddedAt: days(30),
      episodes: [
        { seasonNumber: 1, episodeNumber: 4, addedAt: days(1) },
        { seasonNumber: 1, episodeNumber: 5, addedAt: days(1) },
      ],
    });
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.RECENT_VIEW
    );
    const res = await agent.get('/discover/recentlyadded?days=7');
    const item = res.body.results.find(
      (r: { media: { tmdbId: number } }) => r.media.tmdbId === 2
    );
    assert.ok(item);
    assert.strictEqual(item.episodeCount, 2);
    assert.deepStrictEqual(
      item.newEpisodes.map((e: { episodeNumber: number }) => e.episodeNumber),
      [4, 5]
    );
  });

  it('excludes media without recent activity', async () => {
    await seedMedia({ tmdbId: 3, mediaAddedAt: days(30) });
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.RECENT_VIEW
    );
    const res = await agent.get('/discover/recentlyadded?days=7');
    const item = res.body.results.find(
      (r: { media: { tmdbId: number } }) => r.media.tmdbId === 3
    );
    assert.strictEqual(item, undefined);
  });

  it('sorts by latest event desc and paginates', async () => {
    await seedMedia({ tmdbId: 4, mediaAddedAt: days(3) });
    await seedMedia({ tmdbId: 5, mediaAddedAt: days(1) });
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.RECENT_VIEW
    );
    const first = await agent.get(
      '/discover/recentlyadded?days=7&take=1&skip=0'
    );
    assert.strictEqual(first.body.results.length, 1);
    assert.strictEqual(first.body.results[0].media.tmdbId, 5);
    assert.strictEqual(first.body.pageInfo.results, 2);
    const second = await agent.get(
      '/discover/recentlyadded?days=7&take=1&skip=1'
    );
    assert.strictEqual(second.body.results[0].media.tmdbId, 4);
  });

  it('returns empty results when nothing is recent', async () => {
    await seedMedia({ tmdbId: 6, mediaAddedAt: days(60) });
    const agent = await loginWithPermissions(
      'friend@sinerr.dev',
      Permission.REQUEST | Permission.RECENT_VIEW
    );
    const res = await agent.get('/discover/recentlyadded?days=7');
    assert.strictEqual(res.body.results.length, 0);
  });
});
