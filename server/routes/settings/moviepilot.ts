import MoviePilotAPI from '@server/api/moviepilot';
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

export default moviepilotRoutes;
