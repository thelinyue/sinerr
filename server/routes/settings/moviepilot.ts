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

    // 连接成功后一并拉取下载器/路径/站点，供前端渲染请求级配置下拉
    // （对应 seerr 的 DVRTestResponse：profiles/rootFolders/tags）。
    const [downloaders, paths, sites] = await Promise.all([
      moviepilot.getDownloadClients(),
      moviepilot.getDownloadPaths(),
      moviepilot.getSiteList(),
    ]);

    return res.status(200).json({ status, downloaders, paths, sites });
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
 * 返回指定 MoviePilot 服务器的可用下载器（对应 Sonarr/Radarr 的 quality profile 下拉之外的
 * 下载目标）。按服务器 ID 实例化客户端，避免把 apiKey 暴露给前端。
 */
moviepilotRoutes.get<{ id: string }>(
  '/:id/downloaders',
  async (req, res, next) => {
    const settings = getSettings();
    const server = settings.moviepilot.find(
      (m) => m.id === Number(req.params.id)
    );

    if (!server) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    try {
      const moviepilot = new MoviePilotAPI({
        url: MoviePilotAPI.buildUrl(server),
        apiKey: server.apiKey,
      });
      const clients = await moviepilot.getDownloadClients();
      return res.status(200).json(clients);
    } catch (e) {
      logger.error('Failed to fetch MoviePilot download clients', {
        label: 'MoviePilot',
        serverId: server.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: `Failed to fetch download clients: ${e.message}`,
      });
    }
  }
);

/**
 * 返回指定 MoviePilot 服务器的可用下载路径（对应 Sonarr/Radarr 的 root folder 下拉）。
 */
moviepilotRoutes.get<{ id: string }>('/:id/paths', async (req, res, next) => {
  const settings = getSettings();
  const server = settings.moviepilot.find(
    (m) => m.id === Number(req.params.id)
  );

  if (!server) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  try {
    const moviepilot = new MoviePilotAPI({
      url: MoviePilotAPI.buildUrl(server),
      apiKey: server.apiKey,
    });
    const paths = await moviepilot.getDownloadPaths();
    return res.status(200).json(paths);
  } catch (e) {
    logger.error('Failed to fetch MoviePilot download paths', {
      label: 'MoviePilot',
      serverId: server.id,
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: `Failed to fetch download paths: ${e.message}`,
    });
  }
});

/**
 * 返回指定 MoviePilot 服务器的可用站点（对应 Sonarr/Radarr 的 tag 下拉，限定订阅搜索范围）。
 */
moviepilotRoutes.get<{ id: string }>('/:id/sites', async (req, res, next) => {
  const settings = getSettings();
  const server = settings.moviepilot.find(
    (m) => m.id === Number(req.params.id)
  );

  if (!server) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  try {
    const moviepilot = new MoviePilotAPI({
      url: MoviePilotAPI.buildUrl(server),
      apiKey: server.apiKey,
    });
    const sites = await moviepilot.getSiteList();
    return res.status(200).json(sites);
  } catch (e) {
    logger.error('Failed to fetch MoviePilot sites', {
      label: 'MoviePilot',
      serverId: server.id,
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: `Failed to fetch sites: ${e.message}`,
    });
  }
});

export default moviepilotRoutes;
