import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import { User } from '@server/entity/User';
import { jellyfinRecentScanner } from '@server/lib/scanners/jellyfin';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const webhookRoutes = Router();

/**
 * 解析 Emby/Jellyfin Webhook 载荷中的 tmdbId
 *
 * Jellyfin Webhook 插件会提供 `Provider_tmdb` 字段（BaseItem 的
 * Provider_{providerId_lowercase}）。部分 Emby 版本用 `ProviderIds.Tmdb`。
 */
function extractTmdbId(body: Record<string, unknown>): number | undefined {
  const providerTmdb = body.Provider_tmdb;
  if (providerTmdb != null && providerTmdb !== '') {
    const parsed = Number(providerTmdb);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  const providerIds = (body.ProviderIds ?? {}) as Record<string, unknown>;
  const nestedTmdb = providerIds.Tmdb ?? providerIds.tmdb;
  if (nestedTmdb != null && nestedTmdb !== '') {
    const parsed = Number(nestedTmdb);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * 处理播放通知，写入播放记录
 *
 * 仅处理 playback.start / playback.stop。stop 事件携带 PlayedToCompletion
 * 用于标记是否看完；对没有该字段的版本，stop 即视为产生一次播放记录。
 */
async function handlePlaybackEvent(
  body: Record<string, unknown>
): Promise<void> {
  const event = body.Event as string | undefined;
  const userId = (body.UserId ?? (body.User as Record<string, unknown>)?.Id) as
    | string
    | undefined;

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

  const tmdbId = extractTmdbId(body);
  if (!tmdbId) {
    logger.debug('Playback webhook missing tmdbId, skipping', {
      label: 'Webhook',
      event,
      itemName: body.Name,
    });
    return;
  }

  const itemType = body.ItemType as string | undefined;
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

  const completed =
    event === 'playback.stop'
      ? body.PlayedToCompletion === true || body.PlayedToCompletion === 'true'
      : false;

  const playbackEventRepository = getRepository(PlaybackEvent);
  await playbackEventRepository.save(
    new PlaybackEvent({
      user,
      tmdbId,
      mediaType,
      completed,
      seasonNumber:
        body.SeasonNumber != null ? Number(body.SeasonNumber) : null,
      episodeNumber:
        body.EpisodeNumber != null ? Number(body.EpisodeNumber) : null,
    })
  );

  logger.info('Recorded playback event from webhook', {
    label: 'Webhook',
    event,
    tmdbId,
    mediaType,
    completed,
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
