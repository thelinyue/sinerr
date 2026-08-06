import MoviePilotAPI from '@server/api/moviepilot';
import {
  getSubscriptionFeedCache,
  refreshSubscriptionFeedCache,
} from '@server/job/refreshSubscriptionFeedCache';
import type { MoviePilotServerSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const moviepilotRoutes = Router();

moviepilotRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.moviepilot ?? []);
});

moviepilotRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const newMoviePilot = req.body as MoviePilotServerSettings;
  const lastItem = settings.moviepilot[settings.moviepilot.length - 1];
  newMoviePilot.id = lastItem ? lastItem.id + 1 : 0;

  if (req.body.isDefault) {
    settings.moviepilot.forEach((instance) => {
      instance.isDefault = false;
    });
  }

  settings.moviepilot = [...settings.moviepilot, newMoviePilot];
  await settings.save();

  return res.status(201).json(newMoviePilot);
});

moviepilotRoutes.post('/test', async (req, res, next) => {
  try {
    const moviepilot = new MoviePilotAPI({
      apiKey: req.body.apiKey,
      url: MoviePilotAPI.buildUrl(req.body),
    });

    const status = await moviepilot.getSystemStatus();

    return res.status(200).json(status);
  } catch (e) {
    logger.error('Failed to test MoviePilot connection', {
      label: 'MoviePilot',
      message: e.message,
    });

    next({
      status: 500,
      message: `Failed to connect to MoviePilot: ${e.message}`,
    });
  }
});

moviepilotRoutes.put<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();

  const index = settings.moviepilot.findIndex(
    (m) => m.id === Number(req.params.id)
  );

  if (index === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  if (req.body.isDefault) {
    settings.moviepilot.forEach((instance) => {
      instance.isDefault = false;
    });
  }

  settings.moviepilot[index] = {
    ...req.body,
    id: Number(req.params.id),
  } as MoviePilotServerSettings;
  await settings.save();

  return res.status(200).json(settings.moviepilot[index]);
});

moviepilotRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();

  const index = settings.moviepilot.findIndex(
    (m) => m.id === Number(req.params.id)
  );

  if (index === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.moviepilot.splice(index, 1);
  await settings.save();

  return res.status(200).json(removed[0]);
});

/**
 * 订阅更新速递（本周热播「更新速递」折叠条数据源）
 *
 * GET：返回定时任务缓存的订阅中影片更新动态（即将更新 / 最近更新）。
 * POST：手动触发一次缓存刷新（管理员可点击刷新）。
 */
moviepilotRoutes.get('/feed', (_req, res) => {
  const feed = getSubscriptionFeedCache();
  res.status(200).json(feed ?? { generatedAt: 0, entries: [] });
});

moviepilotRoutes.post('/feed/refresh', async (_req, res, next) => {
  try {
    await refreshSubscriptionFeedCache();
    const feed = getSubscriptionFeedCache();
    res.status(200).json(feed ?? { generatedAt: 0, entries: [] });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

export default moviepilotRoutes;
