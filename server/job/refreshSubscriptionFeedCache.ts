import { getMetadataProvider } from '@server/api/metadata';
import MoviePilotAPI, {
  type MoviePilotSubscription,
} from '@server/api/moviepilot';
import { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Media from '@server/entity/Media';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';

/**
 * 订阅更新速递缓存（Sinerr 2.0 模块：本周热播「更新速递」）
 *
 * 每天定时拉取一次 MoviePilot「订阅中」的影片，聚合它们的更新动态：
 * - 即将更新（预告）：剧集订阅的 TMDB nextEpisodeToAir（下一集播出时间）
 * - 最近更新（回顾）：本地 recentlyAdded 匹配到的已入库新集
 *
 * 与 mostplayed 缓存同模式：内存缓存 + 落盘 JSON + 定时刷新，前端读静态缓存。
 */
export interface SubscriptionFeedEntry {
  /** 订阅 tmdbId */
  tmdbId: number;
  /** 媒体类型 */
  mediaType: 'movie' | 'tv';
  /** 剧集订阅的季号 */
  season?: number | null;
  /** 订阅名称 */
  name: string;
  /** 订阅年份 */
  year?: string | null;
  /** 即将更新：下一集季号 */
  nextSeason?: number | null;
  /** 即将更新：下一集集号 */
  nextEpisode?: number | null;
  /** 即将更新：播出日期（ISO） */
  nextAirDate?: string | null;
  /** 最近更新：最新集入库时间（ISO） */
  lastAddedAt?: string | null;
  /** 最近更新：窗口内新增集数 */
  episodeCount?: number;
  /** 海报路径 */
  posterPath?: string | null;
}

export interface SubscriptionFeedCache {
  /** 生成时间戳（毫秒） */
  generatedAt: number;
  /** 全部条目（按状态分组由前端处理） */
  entries: SubscriptionFeedEntry[];
}

let feedCache: SubscriptionFeedCache = {
  generatedAt: 0,
  entries: [],
};

const CACHE_FILE = 'subscription_feed_cache.json';

function loadCacheFromDisk(): void {
  try {
    const filePath = path.join(appDataPath(), CACHE_FILE);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.entries) {
        feedCache = data;
        logger.info('Loaded subscription feed cache from disk', {
          label: 'Jobs',
        });
      }
    }
  } catch (e) {
    logger.warn('Failed to load subscription feed cache from disk', {
      label: 'Jobs',
      message: e.message,
    });
  }
}

function saveCacheToDisk(): void {
  try {
    const filePath = path.join(appDataPath(), CACHE_FILE);
    fs.writeFileSync(filePath, JSON.stringify(feedCache), 'utf-8');
  } catch (e) {
    logger.warn('Failed to save subscription feed cache to disk', {
      label: 'Jobs',
      message: e.message,
    });
  }
}

// Load persisted cache on startup
loadCacheFromDisk();

/** 前端读取「更新速递」缓存 */
export function getSubscriptionFeedCache(): SubscriptionFeedCache | null {
  if (feedCache.entries.length === 0) {
    return null;
  }
  return feedCache;
}

/** 拉取指定 MP 服务器的「订阅中」订阅 */
async function fetchActiveSubscriptions(
  moviepilot: MoviePilotAPI
): Promise<MoviePilotSubscription[]> {
  try {
    const all = await moviepilot.getSubscriptions();
    // state：R=订阅中，P=暂停，S=完成。仅展示订阅中的剧集/电影。
    return all.filter((sub) => sub.state === 'R');
  } catch (e) {
    logger.warn('MoviePilot feed failed to fetch subscriptions', {
      label: 'Jobs',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** 批量查询剧集 TMDB 详情（限并发，避免打爆 TMDB 限流） */
async function fetchTvDetails(
  tmdbIds: number[],
  concurrency = 5
): Promise<
  {
    tmdbId: number;
    name: string | null;
    nextSeason: number | null;
    nextEpisode: number | null;
    nextAirDate: string | null;
    posterPath: string | null;
  }[]
> {
  const results: {
    tmdbId: number;
    name: string | null;
    nextSeason: number | null;
    nextEpisode: number | null;
    nextAirDate: string | null;
    posterPath: string | null;
  }[] = [];
  const provider = await getMetadataProvider('tv');

  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < tmdbIds.length) {
      const current = idx++;
      const tmdbId = tmdbIds[current];
      try {
        const show = await provider.getTvShow({ tvId: tmdbId });
        const next = show.next_episode_to_air;
        results.push({
          tmdbId,
          name: show.name ?? null,
          nextSeason: next?.season_number ?? null,
          nextEpisode: next?.episode_number ?? null,
          nextAirDate: next?.air_date ?? null,
          posterPath: show.poster_path ?? null,
        });
      } catch (e) {
        logger.warn('MoviePilot feed failed to fetch tv details', {
          label: 'Jobs',
          tmdbId,
          errorMessage: e.message,
        });
        results.push({
          tmdbId,
          name: null,
          nextSeason: null,
          nextEpisode: null,
          nextAirDate: null,
          posterPath: null,
        });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** 刷新订阅更新速递缓存 */
export async function refreshSubscriptionFeedCache(): Promise<void> {
  const servers = getSettings().moviepilot;
  if (servers.length === 0) {
    logger.debug(
      'Skipping subscription feed refresh: MoviePilot not configured',
      { label: 'Jobs' }
    );
    return;
  }

  try {
    logger.info(
      'Refreshing subscription feed cache from MoviePilot subscriptions',
      { label: 'Jobs' }
    );

    // 合并所有 MP 服务器的订阅中订阅（按 tmdbId 去重）
    const activeByTmdb = new Map<number, MoviePilotSubscription>();
    for (const server of servers) {
      const moviepilot = new MoviePilotAPI({
        url: MoviePilotAPI.buildUrl(server),
        apiKey: server.apiKey,
      });
      const active = await fetchActiveSubscriptions(moviepilot);
      for (const sub of active) {
        if (sub.tmdbid == null) continue;
        if (!activeByTmdb.has(sub.tmdbid)) {
          activeByTmdb.set(sub.tmdbid, sub);
        }
      }
    }

    const tvIds = [...activeByTmdb.entries()]
      .filter(([, sub]) => sub.type === 'tv')
      .map(([tmdbId]) => tmdbId);

    const [tvDetails, mediaRows] = await Promise.all([
      fetchTvDetails(tvIds),
      // 匹配本地 Media（拿海报 + 最近新增集）
      tvIds.length
        ? getRepository(Media)
            .createQueryBuilder('media')
            .where('media.tmdbId IN (:...ids)', { ids: tvIds })
            .getMany()
        : [],
    ]);

    const mediaByTmdb = new Map(mediaRows.map((m) => [m.tmdbId, m]));

    // 本地最近入库新集（近 30 天，仅覆盖已入库媒体）
    const recentWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentEpisodes = mediaRows.length
      ? await getRepository(Episode)
          .createQueryBuilder('episode')
          .leftJoinAndSelect('episode.media', 'media')
          .where('episode.addedAt >= :since', { since: recentWindow })
          .getMany()
      : [];
    const episodeCountByMediaId = new Map<number, number>();
    const latestAddedByMediaId = new Map<number, Date>();
    for (const ep of recentEpisodes) {
      const mediaId = ep.media?.id;
      if (!mediaId) continue;
      episodeCountByMediaId.set(
        mediaId,
        (episodeCountByMediaId.get(mediaId) ?? 0) + 1
      );
      const cur = latestAddedByMediaId.get(mediaId);
      if (!cur || ep.addedAt > cur) {
        latestAddedByMediaId.set(mediaId, ep.addedAt);
      }
    }

    const detailsByTmdb = new Map(tvDetails.map((d) => [d.tmdbId, d]));

    const entries: SubscriptionFeedEntry[] = [...activeByTmdb.entries()].map(
      ([tmdbId, sub]) => {
        const media = mediaByTmdb.get(tmdbId);
        const tvDetail = sub.type === 'tv' ? detailsByTmdb.get(tmdbId) : null;
        return {
          tmdbId,
          mediaType: sub.type === 'tv' ? 'tv' : 'movie',
          season: sub.season ?? null,
          name: tvDetail?.name ?? String(tmdbId),
          year: null,
          nextSeason: tvDetail?.nextSeason ?? null,
          nextEpisode: tvDetail?.nextEpisode ?? null,
          nextAirDate: tvDetail?.nextAirDate ?? null,
          lastAddedAt: media
            ? (latestAddedByMediaId.get(media.id)?.toISOString() ?? null)
            : null,
          episodeCount: media ? (episodeCountByMediaId.get(media.id) ?? 0) : 0,
          posterPath: tvDetail?.posterPath ?? null,
        };
      }
    );

    feedCache = { generatedAt: Date.now(), entries };
    saveCacheToDisk();
    logger.info(
      `Subscription feed cache refreshed: ${entries.length} active subscriptions`,
      { label: 'Jobs' }
    );
  } catch (e) {
    logger.error(`Failed to refresh subscription feed cache: ${e.message}`, {
      label: 'Jobs',
    });
  }
}
