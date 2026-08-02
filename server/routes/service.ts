import MediaryAPI from '@server/api/mediary';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

interface ServiceServer {
  id: number;
  name: string;
  isDefault: boolean;
}

const serviceRoutes = Router();

serviceRoutes.get('/mediary', async (req, res) => {
  const settings = getSettings();

  const filteredServers: ServiceServer[] = settings.mediary.map((m) => ({
    id: m.id,
    name: m.name,
    isDefault: m.isDefault,
  }));

  return res.status(200).json(filteredServers);
});

serviceRoutes.get('/mediary/status', async (req, res, next) => {
  const tmdbId = Number(req.query.tmdbId);
  const mediaType = req.query.mediaType as 'movie' | 'tv' | undefined;

  if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) {
    return next({
      status: 400,
      message: 'tmdbId and mediaType query parameters are required.',
    });
  }

  const settings = getSettings();
  const defaultMediary =
    settings.mediary.find((m) => m.isDefault) ?? settings.mediary[0];

  if (!defaultMediary) {
    return res.status(200).json({ configured: false });
  }

  try {
    const mediary = new MediaryAPI({
      url: MediaryAPI.buildUrl(defaultMediary),
      apiKey: defaultMediary.apiKey,
    });
    const status = await mediary.getSubscriptionStatus(tmdbId, mediaType);

    return res.status(200).json({ configured: true, status });
  } catch (e) {
    logger.error('Failed to retrieve Mediary subscription status', {
      label: 'Mediary',
      tmdbId,
      mediaType,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(200).json({ configured: true, status: {}, error: true });
  }
});

export default serviceRoutes;
