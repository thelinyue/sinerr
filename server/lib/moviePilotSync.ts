import MoviePilotAPI, {
  type MoviePilotSubscription,
} from '@server/api/moviepilot';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import SeasonRequest from '@server/entity/SeasonRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * 判断某个 MoviePilot 订阅是否处于完成态。
 * 优先看 `state === 'S'`；订阅对象缺少 state 时，按集数进度兜底判断
 * （total_episode > 0 且 completed_episode >= total_episode）。
 */
export function isMoviePilotSubscriptionCompleted(
  sub: MoviePilotSubscription
): boolean {
  if (String(sub.state) === 'S') {
    return true;
  }
  const full = sub as unknown as Record<string, unknown>;
  const total = Number(full.total_episode ?? 0);
  const completed = Number(full.completed_episode ?? 0);
  return total > 0 && completed >= total;
}

/**
 * 已订阅且完成（state === 'S'）时，直接把请求置为 COMPLETED、媒体标记 AVAILABLE，
 * 不再走 PROCESSING。返回请求是否已全部完成：
 * - 电影：存在完成态订阅即视为完成；
 * - 剧集：请求涉及的所有季均存在完成态订阅才视为完成（部分季完成时仅标记对应季）。
 */
export async function completeRequestForMoviePilot(
  entity: MediaRequest,
  subscriptions: MoviePilotSubscription[]
): Promise<boolean> {
  if (entity.type === MediaType.MOVIE) {
    if (!subscriptions.some((sub) => isMoviePilotSubscriptionCompleted(sub))) {
      return false;
    }
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: entity.media.id },
    });
    if (media && media.status !== MediaStatus.AVAILABLE) {
      media.status = MediaStatus.AVAILABLE;
      await mediaRepository.save(media);
    }
    entity.status = MediaRequestStatus.COMPLETED;
    await getRepository(MediaRequest).save(entity);
    logger.info(
      'Movie already completed in MoviePilot, request marked completed',
      {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        tmdbId: entity.media.tmdbId,
      }
    );
    return true;
  }

  const seasonRequestRepository = getRepository(SeasonRequest);
  const seasonRepository = getRepository(Season);
  const requestedSeasons = entity.seasons ?? [];

  let completedCount = 0;
  for (const seasonRequest of requestedSeasons) {
    const completed = subscriptions.some(
      (sub) =>
        sub.season === seasonRequest.seasonNumber &&
        isMoviePilotSubscriptionCompleted(sub)
    );
    if (!completed) {
      continue;
    }
    seasonRequest.status = MediaRequestStatus.COMPLETED;
    await seasonRequestRepository.save(seasonRequest);

    const season = await seasonRepository.findOne({
      where: {
        media: { id: entity.media.id },
        seasonNumber: seasonRequest.seasonNumber,
      },
    });
    if (season && season.status !== MediaStatus.AVAILABLE) {
      season.status = MediaStatus.AVAILABLE;
      await seasonRepository.save(season);
    }
    completedCount++;
  }

  const allCompleted =
    requestedSeasons.length > 0 && completedCount === requestedSeasons.length;

  if (allCompleted) {
    entity.status = MediaRequestStatus.COMPLETED;
    await getRepository(MediaRequest).save(entity);
  }

  if (completedCount > 0) {
    logger.info(
      allCompleted
        ? 'All requested seasons already completed in MoviePilot, request marked completed'
        : 'Some requested seasons already completed in MoviePilot, marked their seasons available',
      {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        tmdbId: entity.media.tmdbId,
        completedSeasons: requestedSeasons
          .filter((sr) => sr.status === MediaRequestStatus.COMPLETED)
          .map((sr) => sr.seasonNumber),
      }
    );
  }

  return allCompleted;
}

/**
 * 定期同步（对应服务器设置里的"启用扫描"）：轮询启用了 syncEnabled 的 MoviePilot
 * 服务器订阅列表，凡处于完成态（state === 'S'）的订阅，把 Sinerr 中对应的
 * APPROVED 请求自动置为 COMPLETED、媒体/季标记 AVAILABLE。
 */
export async function runMoviePilotSync(): Promise<void> {
  const servers = getSettings().moviepilot.filter((s) => s.syncEnabled);
  if (servers.length === 0) {
    return;
  }

  const requestRepository = getRepository(MediaRequest);

  for (const server of servers) {
    const moviepilot = new MoviePilotAPI({
      url: MoviePilotAPI.buildUrl(server),
      apiKey: server.apiKey,
    });

    let subscriptions: MoviePilotSubscription[];
    try {
      subscriptions = await moviepilot.getSubscriptions();
    } catch (e) {
      logger.warn('MoviePilot sync failed to fetch subscriptions', {
        label: 'MoviePilot Sync',
        serverId: server.id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // 按 tmdbId 聚合已完成订阅，避免对同一媒体反复查询
    const completedByTmdb = new Map<number, MoviePilotSubscription[]>();
    for (const sub of subscriptions) {
      if (sub.tmdbid == null || !isMoviePilotSubscriptionCompleted(sub)) {
        continue;
      }
      const list = completedByTmdb.get(sub.tmdbid) ?? [];
      list.push(sub);
      completedByTmdb.set(sub.tmdbid, list);
    }

    for (const [tmdbId, subs] of completedByTmdb) {
      const requests = await requestRepository.find({
        where: {
          media: { tmdbId },
          status: MediaRequestStatus.APPROVED,
        },
        relations: { media: true, seasons: true },
      });

      for (const request of requests) {
        try {
          await completeRequestForMoviePilot(request, subs);
        } catch (e) {
          logger.warn('MoviePilot sync failed to complete request', {
            label: 'MoviePilot Sync',
            serverId: server.id,
            requestId: request.id,
            tmdbId,
            errorMessage: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }
}
