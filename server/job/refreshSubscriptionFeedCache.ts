import { getMetadataProvider } from '@server/api/metadata';
import MoviePilotAPI, {
  type MoviePilotSubscription,
} from '@server/api/moviepilot';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import fs from 'fs';
import path from 'path';

/**
 * 追剧日历缓存（本周热播「追剧日历」）
 *
 * 每天定时拉取一次 MoviePilot「订阅中」的影片，聚合未来 7 天有更新的集：
 * - 剧集订阅：TMDB getTvSeason 拿整季 air_date，筛出未来 7 天要更新的集
 *
 * 与 mostplayed 缓存同模式：内存缓存 + 落盘 JSON + 定时刷新，前端读静态缓存。
 */
export interface CalendarEpisodeUpdate {
  /** 播出日期（YYYY-MM-DD） */
  date: string;
  /** 季号 */
  season: number;
  /** 集号 */
  episode: number;
}

export interface SubscriptionFeedEntry {
  /** 订阅 tmdbId */
  tmdbId: number;
  /** 媒体类型 */
  mediaType: 'movie' | 'tv';
  /** 订阅名称 */
  name: string;
  /** 未来 7 天要更新的集（含 date，按集号升序） */
  updates: CalendarEpisodeUpdate[];
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
    // type：MP 返回中文（电视剧/电影），统一映射为 tv/movie 供过滤使用。
    return all
      .filter((sub) => sub.state === 'R')
      .map((sub) => ({
        ...sub,
        type:
          sub.type === '电视剧'
            ? 'tv'
            : sub.type === '电影'
              ? 'movie'
              : sub.type,
      }));
  } catch (e) {
    logger.warn('MoviePilot feed failed to fetch subscriptions', {
      label: 'Jobs',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** 单集更新点 */
export interface CalendarEpisodeUpdate {
  date: string;
  season: number;
  episode: number;
}

/** 批量查询剧集 TMDB 季集（限并发），筛出今天/明天有更新的集 */
async function fetchTvSeasonUpdates(
  targets: { tmdbId: number; season: number }[],
  concurrency = 5
): Promise<
  {
    tmdbId: number;
    name: string | null;
    posterPath: string | null;
    updates: CalendarEpisodeUpdate[];
  }[]
> {
  const results: {
    tmdbId: number;
    name: string | null;
    posterPath: string | null;
    updates: CalendarEpisodeUpdate[];
  }[] = [];
  const provider = await getMetadataProvider('tv');

  // 未来 7 天（含今天）的 ISO 日期
  const todayISO = new Date();
  todayISO.setHours(0, 0, 0, 0);
  const targetDates = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const day = new Date(todayISO.getTime() + i * 24 * 60 * 60 * 1000);
    targetDates.add(day.toISOString().slice(0, 10));
  }

  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < targets.length) {
      const current = idx++;
      const { tmdbId, season } = targets[current];
      const fallback: {
        tmdbId: number;
        name: string | null;
        posterPath: string | null;
        updates: CalendarEpisodeUpdate[];
      } = { tmdbId, name: null, posterPath: null, updates: [] };
      try {
        const seasonInfo = await provider.getTvSeason({
          tvId: tmdbId,
          seasonNumber: season,
        });
        const updates = (seasonInfo.episodes ?? [])
          .filter((ep) => ep.air_date && targetDates.has(ep.air_date))
          .map((ep) => ({
            date: ep.air_date as string,
            season,
            episode: ep.episode_number,
          }))
          .sort((a, b) => a.episode - b.episode);
        results.push({
          tmdbId,
          name: seasonInfo.name ?? null,
          posterPath: seasonInfo.poster_path ?? null,
          updates,
        });
      } catch (e) {
        logger.warn('MoviePilot feed failed to fetch tv season', {
          label: 'Jobs',
          tmdbId,
          season,
          errorMessage: e.message,
        });
        results.push(fallback);
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

    // 剧集订阅：查 TMDB 整季 air_date，筛今天/明天更新的集
    const tvTargets = [...activeByTmdb.entries()]
      .filter(([, sub]) => sub.type === 'tv' && sub.season != null)
      .map(([tmdbId, sub]) => ({ tmdbId, season: sub.season as number }));

    const seasonUpdates = await fetchTvSeasonUpdates(tvTargets);
    const seasonByTmdb = new Map(seasonUpdates.map((d) => [d.tmdbId, d]));

    const entries: SubscriptionFeedEntry[] = [...activeByTmdb.entries()]
      .map(([tmdbId, sub]) => {
        const tvSeason = sub.type === 'tv' ? seasonByTmdb.get(tmdbId) : null;
        const updates = tvSeason?.updates ?? [];
        return {
          tmdbId,
          mediaType: (sub.type === 'tv' ? 'tv' : 'movie') as 'tv' | 'movie',
          // 剧名优先用 MP 订阅名（TMDB seasonInfo.name 是季名如 "Season 2"）
          name: sub.name ?? tvSeason?.name ?? String(tmdbId),
          updates,
          posterPath: tvSeason?.posterPath ?? null,
        };
      })
      // 仅保留未来 7 天内有更新的条目
      .filter((e) => e.updates.length > 0);

    // 排序：最早更新日期在前的优先
    entries.sort((a, b) => {
      const aDate = a.updates[0]?.date ?? '';
      const bDate = b.updates[0]?.date ?? '';
      if (aDate !== bDate) return aDate < bDate ? -1 : 1;
      return 0;
    });

    feedCache = { generatedAt: Date.now(), entries };
    saveCacheToDisk();
    logger.info(
      `Subscription feed cache refreshed: ${entries.length} active subscriptions with updates in next 7 days`,
      { label: 'Jobs' }
    );
  } catch (e) {
    logger.error(`Failed to refresh subscription feed cache: ${e.message}`, {
      label: 'Jobs',
    });
  }
}
