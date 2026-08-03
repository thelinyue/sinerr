import JellyfinAPI from '@server/api/jellyfin';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import { User } from '@server/entity/User';
import { jellyfinRecentScanner } from '@server/lib/scanners/jellyfin';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';
import { Router } from 'express';

const webhookRoutes = Router();

/**
 * Emby/Jellyfin Webhook 载荷中的媒体信息
 *
 * 兼容两种格式：
 * - Jellyfin Webhook 插件：扁平字段（Provider_tmdb / UserId / SeasonNumber ...）
 * - Emby 官方 Webhooks 通知服务：嵌套对象（Item.* / User.Id / PlaybackInfo.* ...）
 */
interface PlaybackBody {
  Event?: string;
  // Jellyfin 扁平字段
  UserId?: string;
  Provider_tmdb?: string;
  ProviderIds?: Record<string, unknown>;
  ItemType?: string;
  SeasonNumber?: unknown;
  EpisodeNumber?: unknown;
  PlayedToCompletion?: unknown;
  // Emby 嵌套对象
  User?: { Id?: string; Name?: string };
  Item?: {
    Id?: string;
    Type?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    SeriesId?: string;
    ProviderIds?: Record<string, unknown>;
    Path?: string;
  };
  PlaybackInfo?: {
    MediaSource?: {
      RunTimeTicks?: number;
    };
    PositionTicks?: number;
  };
}

/**
 * 解析载荷中的 tmdbId（分层提取）
 *
 * 优先级：
 * 1. Jellyfin 顶层 Provider_tmdb
 * 2. Jellyfin 顶层 ProviderIds.Tmdb
 * 3. Emby Item.ProviderIds.Tmdb / TheMovieDb
 * 4. Emby Item.Path 中的 {tmdb-xxxx}（strm 目录约定，如 MoviePilot 生成）
 */
function extractTmdbId(body: Record<string, unknown>): number | undefined {
  const b = body as PlaybackBody;
  const tryParse = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined;
    const parsed = Number(v);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  // 1. Jellyfin 顶层
  const topLevel = tryParse(b.Provider_tmdb);
  if (topLevel) return topLevel;

  // 2. 顶层 ProviderIds
  const topProviderIds = (body.ProviderIds ?? {}) as Record<string, unknown>;
  const topNested = tryParse(topProviderIds.Tmdb ?? topProviderIds.tmdb);
  if (topNested) return topNested;

  // 3. Emby Item.ProviderIds
  if (b.Item?.ProviderIds) {
    const itemNested = tryParse(
      b.Item.ProviderIds.Tmdb ?? b.Item.ProviderIds.TheMovieDb
    );
    if (itemNested) return itemNested;
  }

  // 4. Emby Item.Path 中的 {tmdb-xxxx}
  if (b.Item?.Path) {
    const match = b.Item.Path.match(/\{tmdb-(\d+)\}/i);
    if (match) {
      const fromPath = tryParse(match[1]);
      if (fromPath) return fromPath;
    }
  }

  return undefined;
}

/**
 * 通过 Emby API 按 ItemId 反查 tmdbId（最后兜底）
 */
async function lookupTmdbByItemId(itemId: string): Promise<number | undefined> {
  try {
    const settings = getSettings();
    const hostname = getHostname();
    const jellyfinClient = new JellyfinAPI(
      hostname,
      settings.jellyfin.apiKey,
      'BOT_sinerr',
      settings.main.mediaServerType
    );
    const item = await jellyfinClient.getItemData(itemId);
    const providerIds = item?.ProviderIds;
    if (!providerIds) return undefined;
    const parsed = Number(providerIds.Tmdb ?? providerIds.TheMovieDb);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch (e) {
    logger.debug('Failed to look up tmdbId by Emby ItemId', {
      label: 'Webhook',
      itemId,
      message: e instanceof Error ? e.message : 'Unknown error',
    });
    return undefined;
  }
}

/**
 * 处理播放通知，写入播放记录
 *
 * 仅处理 playback.start / playback.stop。stop 事件优先使用 PlayedToCompletion，
 * 否则用播放位置/总时长计算完成度（>=90% 视为看完）。
 */
async function handlePlaybackEvent(
  body: Record<string, unknown>
): Promise<void> {
  const b = body as PlaybackBody;
  const event = b.Event;
  const userId = b.UserId ?? b.User?.Id;

  if (!userId) {
    logger.debug('Playback webhook missing UserId, skipping', {
      label: 'Webhook',
      event,
    });
    return;
  }

  const userRepository = getRepository(User);
  const user = await userRepository.findOne({
    where: { jellyfinUserId: userId },
  });

  if (!user) {
    logger.debug('Playback webhook user not found in Sinerr, skipping', {
      label: 'Webhook',
      userId,
      event,
    });
    return;
  }

  let tmdbId = extractTmdbId(body);

  // 兜底：用 ItemId 调 Emby API 反查
  if (!tmdbId && b.Item?.Id) {
    tmdbId = await lookupTmdbByItemId(b.Item.Id);
  }

  if (!tmdbId) {
    logger.debug('Playback webhook missing tmdbId, skipping', {
      label: 'Webhook',
      event,
      itemName: b.Item?.Path ?? body.Name,
    });
    return;
  }

  const itemType = b.Item?.Type ?? (body.ItemType as string | undefined);
  let mediaType: MediaType;
  if (itemType === 'Episode') {
    mediaType = MediaType.TV;
  } else if (itemType === 'Movie') {
    mediaType = MediaType.MOVIE;
  } else if (itemType === 'Series' || itemType === 'Season') {
    mediaType = MediaType.TV;
  } else {
    logger.debug('Playback webhook unsupported item type, skipping', {
      label: 'Webhook',
      event,
      itemType,
    });
    return;
  }

  // playback.stop 视为一次完整的播放记录；playback.start 也记录（开始观看）
  if (event !== 'playback.stop' && event !== 'playback.start') {
    return;
  }

  // 完成度判断
  let completed =
    event === 'playback.stop' &&
    (b.PlayedToCompletion === true || b.PlayedToCompletion === 'true');

  // stop 事件无显式完成标记时，用播放位置/总时长估算
  if (
    event === 'playback.stop' &&
    !completed &&
    b.PlaybackInfo?.MediaSource?.RunTimeTicks
  ) {
    const position = b.PlaybackInfo.PositionTicks ?? 0;
    const runtime = b.PlaybackInfo.MediaSource.RunTimeTicks;
    completed = runtime > 0 && position / runtime >= 0.9;
  }

  const seasonNumber =
    b.Item?.ParentIndexNumber ??
    (body.SeasonNumber != null ? Number(body.SeasonNumber) : null);
  const episodeNumber =
    b.Item?.IndexNumber ??
    (body.EpisodeNumber != null ? Number(body.EpisodeNumber) : null);

  // 本次播放时长（秒）：stop 事件用 PositionTicks（10ms 单位）计算
  // start 事件没有有效时长，记 0
  let durationSeconds = 0;
  if (event === 'playback.stop' && b.PlaybackInfo?.PositionTicks != null) {
    durationSeconds = Math.round(b.PlaybackInfo.PositionTicks / 10000000);
  }

  const playbackEventRepository = getRepository(PlaybackEvent);

  // 播放记录去重：同一用户重复观看同一媒体（剧集或电影）时不刷屏。
  // 剧集维度 = user + tmdbId + tv；电影维度 = user + tmdbId + movie。
  // 重复播放规则：
  // - 已看完的内容再次播放 → 忽略（不刷新时间）
  // - 仍未看完再次播放 → 忽略（避免反复 stop 把记录顶到动态流顶部）
  // - 从未看完 → 看完 → 更新完成状态并刷新时间
  // 剧集额外支持：播放到新的一集时，推进为最新集并刷新时间。
  if (mediaType === MediaType.TV || mediaType === MediaType.MOVIE) {
    const existing = await playbackEventRepository.findOne({
      where: { user: { id: user.id }, tmdbId, mediaType },
    });
    if (existing) {
      // 剧集播放到新的一集：正常推进为最新集
      const isNewTvEpisode =
        mediaType === MediaType.TV &&
        !(
          existing.seasonNumber === seasonNumber &&
          existing.episodeNumber === episodeNumber
        );

      if (isNewTvEpisode) {
        existing.completed = completed;
        existing.durationSeconds = durationSeconds;
        existing.seasonNumber = seasonNumber;
        existing.episodeNumber = episodeNumber;
        existing.createdAt = new Date();
        await playbackEventRepository.save(existing);

        logger.info('Updated latest playback event for series', {
          label: 'Webhook',
          event,
          tmdbId,
          completed,
          durationSeconds,
          seasonNumber,
          episodeNumber,
          user: user.displayName,
        });
        return;
      }

      // 同一部电影或同一集重复播放：
      // 已看完再次播放、或仍未看完再次播放 → 忽略；
      // 仅「从未看完 → 看完」更新完成状态并刷新时间
      if (existing.completed || !completed) {
        logger.debug('Skipping repeat playback event', {
          label: 'Webhook',
          event,
          tmdbId,
          mediaType,
          seasonNumber,
          episodeNumber,
          user: user.displayName,
        });
        return;
      }

      existing.completed = true;
      existing.durationSeconds = durationSeconds;
      existing.createdAt = new Date();
      await playbackEventRepository.save(existing);

      logger.info('Marked media as completed on repeat play', {
        label: 'Webhook',
        event,
        tmdbId,
        mediaType,
        durationSeconds,
        user: user.displayName,
      });
      return;
    }
  }

  await playbackEventRepository.save(
    new PlaybackEvent({
      user,
      tmdbId,
      mediaType,
      completed,
      durationSeconds,
      seasonNumber,
      episodeNumber,
    })
  );

  logger.info('Recorded playback event from webhook', {
    label: 'Webhook',
    event,
    tmdbId,
    mediaType,
    completed,
    durationSeconds,
    seasonNumber,
    episodeNumber,
    user: user.displayName,
  });
}

webhookRoutes.post('/emby', async (req, res) => {
  const configuredApiKey = getSettings().main.apiKey;
  const providedApiKey = req.query.api_key as string | undefined;

  if (configuredApiKey && providedApiKey !== configuredApiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const event = req.body?.Event;
  const itemType = req.body?.ItemType;
  const itemName = req.body?.Name;

  logger.info('Received Jellyfin webhook', {
    label: 'Webhook',
    event,
    itemType,
    itemName,
  });

  // 调试：打印播放事件完整载荷，用于确认字段（UserId/tmdbId/ItemType/完成度）
  if (event === 'playback.start' || event === 'playback.stop') {
    logger.debug('Playback webhook full payload', {
      label: 'Webhook',
      event,
      body: req.body,
    });
  }

  if (event === 'playback.start' || event === 'playback.stop') {
    // 播放事件同步处理（写入较快），失败不影响 webhook 响应
    try {
      await handlePlaybackEvent(req.body as Record<string, unknown>);
    } catch (e) {
      logger.error('Error handling playback webhook event', {
        label: 'Webhook',
        event,
        message: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  if (
    event === 'library.new' ||
    event === 'system.libraryscancomplete' ||
    event === 'item.updated'
  ) {
    if (jellyfinRecentScanner.status().running) {
      logger.info('Skipping recent scan: already running', {
        label: 'Webhook',
        event,
      });
    } else {
      logger.info('Triggering recent scan due to Jellyfin webhook', {
        label: 'Webhook',
        event,
        itemName,
      });
      try {
        await jellyfinRecentScanner.run();
      } catch (e) {
        logger.error('Error during Jellyfin webhook scan', {
          label: 'Webhook',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
  }

  res.status(204).send();
});

export default webhookRoutes;
