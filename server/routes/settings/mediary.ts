import MediaryAPI from '@server/api/mediary';
import type { MediaryServerSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const mediaryRoutes = Router();

mediaryRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.mediary ?? []);
});

mediaryRoutes.post('/', async (req, res) => {
  const settings = getSettings();

  const newMediary = req.body as MediaryServerSettings;
  const lastItem = settings.mediary[settings.mediary.length - 1];
  newMediary.id = lastItem ? lastItem.id + 1 : 0;

  if (req.body.isDefault) {
    settings.mediary.forEach((instance) => {
      instance.isDefault = false;
    });
  }

  settings.mediary = [...settings.mediary, newMediary];
  await settings.save();

  return res.status(201).json(newMediary);
});

mediaryRoutes.post('/test', async (req, res, next) => {
  try {
    const mediary = new MediaryAPI({
      apiKey: req.body.apiKey,
      url: MediaryAPI.buildUrl(req.body),
    });

    const status = await mediary.getSystemStatus();

    return res.status(200).json(status);
  } catch (e) {
    logger.error('Failed to test Mediary connection', {
      label: 'Mediary',
      message: e.message,
    });

    next({
      status: 500,
      message: `Failed to connect to Mediary: ${e.message}`,
    });
  }
});

mediaryRoutes.put<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();

  const index = settings.mediary.findIndex(
    (m) => m.id === Number(req.params.id)
  );

  if (index === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  if (req.body.isDefault) {
    settings.mediary.forEach((instance) => {
      instance.isDefault = false;
    });
  }

  settings.mediary[index] = {
    ...req.body,
    id: Number(req.params.id),
  } as MediaryServerSettings;
  await settings.save();

  return res.status(200).json(settings.mediary[index]);
});

mediaryRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();

  const index = settings.mediary.findIndex(
    (m) => m.id === Number(req.params.id)
  );

  if (index === -1) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.mediary.splice(index, 1);
  await settings.save();

  return res.status(200).json(removed[0]);
});

export default mediaryRoutes;
