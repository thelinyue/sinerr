import MoviePilotAPI from '@server/api/moviepilot';
import { importMoviePilotSubscriptions } from '@server/lib/moviePilotSync';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

interface ServiceServer {
  id: number;
  name: string;
  isDefault: boolean;
}

const serviceRoutes = Router();

serviceRoutes.get('/moviepilot', async (req, res) => {
  const settings = getSettings();

  const filteredServers: ServiceServer[] = settings.moviepilot.map((m) => ({
    id: m.id,
    name: m.name,
    isDefault: m.isDefault,
  }));

  return res.status(200).json(filteredServers);
});

serviceRoutes.get('/moviepilot/status', async (req, res, next) => {
  const tmdbId = Number(req.query.tmdbId);
  const mediaType = req.query.mediaType as 'movie' | 'tv' | undefined;

  if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) {
    return next({
      status: 400,
      message: 'tmdbId and mediaType query parameters are required.',
    });
  }

  const settings = getSettings();
  const defaultMoviePilot =
    settings.moviepilot.find((m) => m.isDefault) ?? settings.moviepilot[0];

  if (!defaultMoviePilot) {
    return res.status(200).json({ configured: false });
  }

  try {
    const moviepilot = new MoviePilotAPI({
      url: MoviePilotAPI.buildUrl(defaultMoviePilot),
      apiKey: defaultMoviePilot.apiKey,
    });
    const subscriptions = await moviepilot.getSubscriptionsByTmdbId(tmdbId);

    return res.status(200).json({
      configured: true,
      // 保持首个订阅对象，供详情页状态徽章使用
      status: (subscriptions[0] ?? {}) as unknown as Record<string, unknown>,
      // 全部匹配订阅（含每季 season 字段），供请求弹窗判断按季去重
      subscriptions: subscriptions as unknown as Record<string, unknown>[],
      subscribed: subscriptions.length > 0,
      // 是否已有订阅处于完成态（state === 'S'）
      completed: subscriptions.some((sub) => String(sub.state) === 'S'),
    });
  } catch (e) {
    logger.error('Failed to retrieve MoviePilot subscription status', {
      label: 'MoviePilot',
      tmdbId,
      mediaType,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return res.status(200).json({ configured: true, status: {}, error: true });
  }
});

/**
 * 手动把 MoviePilot 当前活跃订阅导入为 Sinerr 请求（状态为已请求，请求人为管理员）。
 * 仅管理员可触发；忽略各服务器的"启用扫描"开关（手动操作即明确意图）。
 */
serviceRoutes.post(
  '/moviepilot/sync',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    try {
      const imported = await importMoviePilotSubscriptions();
      return res.status(200).json({ imported });
    } catch (e) {
      logger.error('Failed to import MoviePilot subscriptions', {
        label: 'MoviePilot',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: `Failed to sync MoviePilot subscriptions: ${e.message}`,
      });
    }
  }
);

export default serviceRoutes;
