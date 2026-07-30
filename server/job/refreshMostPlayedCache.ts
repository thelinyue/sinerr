import JellyfinAPI from '@server/api/jellyfin';
import type { JellyfinLibraryItemExtended } from '@server/api/jellyfin';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { getHostname } from '@server/utils/getHostname';
import fs from 'fs';
import path from 'path';

export interface MostPlayedCacheEntry {
  tmdbId: string;
  count: number;
  name: string;
  mediaType: 'movie' | 'tv';
}

export interface MostPlayedCache {
  generatedAt: number;
  sorted: MostPlayedCacheEntry[];
}

export type RankingPeriod = 'week' | 'month' | 'year';

let mostPlayedCache: Record<RankingPeriod, MostPlayedCache> = {
  week: { generatedAt: 0, sorted: [] },
  month: { generatedAt: 0, sorted: [] },
  year: { generatedAt: 0, sorted: [] },
};

const CACHE_FILE = 'mostplayed_cache.json';

function loadCacheFromDisk(): void {
  try {
    const filePath = path.join(appDataPath(), CACHE_FILE);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.week && data.month && data.year) {
        mostPlayedCache = data;
        logger.info('Loaded most played cache from disk', { label: 'Jobs' });
      }
    }
  } catch (e) {
    logger.warn('Failed to load most played cache from disk', {
      label: 'Jobs',
      message: e.message,
    });
  }
}

function saveCacheToDisk(): void {
  try {
    const filePath = path.join(appDataPath(), CACHE_FILE);
    fs.writeFileSync(filePath, JSON.stringify(mostPlayedCache), 'utf-8');
  } catch (e) {
    logger.warn('Failed to save most played cache to disk', {
      label: 'Jobs',
      message: e.message,
    });
  }
}

// Load persisted cache on startup
loadCacheFromDisk();

export function getMostPlayedCache(period: RankingPeriod = 'week'): MostPlayedCache | null {
  const cached = mostPlayedCache[period];
  if (cached.sorted.length === 0) {
    return null;
  }
  return cached;
}

async function fetchAndAggregate(
  jellyfinClient: JellyfinAPI,
  days: number
): Promise<MostPlayedCacheEntry[]> {
  const reportItems = await jellyfinClient.getPlaybackReport({
    days,
    itemType: '',
    limit: 1000,
  });

  if (reportItems.length === 0) {
    return [];
  }

  const batchSize = 20;
  const allItemData: JellyfinLibraryItemExtended[] = [];
  const allIds = new Set<string>();
  for (let i = 0; i < reportItems.length; i += batchSize) {
    const batch = reportItems.slice(i, i + batchSize);
    const ids = batch.map((item) => item.ItemId).join(',');
    const batchData = await jellyfinClient.getBatchItems(ids);
    allItemData.push(...batchData);
    batchData.forEach((item) => allIds.add(item.Id));
  }

  const itemDataMap = new Map<string, JellyfinLibraryItemExtended>();
  allItemData.forEach((item) => {
    itemDataMap.set(item.Id, item);
  });

  const episodeSeriesIds = new Set<string>();
  for (const reportItem of reportItems) {
    if (reportItem.ItemType === 'Episode') {
      const itemData = itemDataMap.get(reportItem.ItemId);
      if (itemData?.SeriesId && !allIds.has(itemData.SeriesId)) {
        episodeSeriesIds.add(itemData.SeriesId);
        allIds.add(itemData.SeriesId);
      }
    }
  }

  if (episodeSeriesIds.size > 0) {
    const seriesIds = Array.from(episodeSeriesIds);
    for (let i = 0; i < seriesIds.length; i += batchSize) {
      const batch = seriesIds.slice(i, i + batchSize);
      const ids = batch.join(',');
      const batchData = await jellyfinClient.getBatchItems(ids);
      batchData.forEach((item) => {
        itemDataMap.set(item.Id, item);
      });
    }
  }

  const deduped = new Map<
    string,
    { count: number; name: string; mediaType: 'movie' | 'tv' }
  >();

  for (const reportItem of reportItems) {
    let tmdbId: string | undefined;
    let displayName = reportItem.ItemName;

    const itemData = itemDataMap.get(reportItem.ItemId);

    if (reportItem.ItemType === 'Episode') {
      if (itemData?.SeriesId) {
        const seriesData = itemDataMap.get(itemData.SeriesId);
        tmdbId =
          seriesData?.ProviderIds?.Tmdb ||
          seriesData?.ProviderIds?.TheMovieDb;
        displayName = seriesData?.Name || itemData.SeriesName || displayName;
      }
      if (tmdbId) {
        const existing = deduped.get(tmdbId);
        if (existing) {
          existing.count += reportItem.PlayCount;
        } else {
          deduped.set(tmdbId, {
            count: reportItem.PlayCount,
            name: displayName,
            mediaType: 'tv',
          });
        }
      }
    } else {
      tmdbId =
        itemData?.ProviderIds?.Tmdb ||
        itemData?.ProviderIds?.TheMovieDb;
      if (tmdbId) {
        const existing = deduped.get(tmdbId);
        if (existing) {
          existing.count += reportItem.PlayCount;
        } else {
          deduped.set(tmdbId, {
            count: reportItem.PlayCount,
            name: displayName,
            mediaType:
              reportItem.ItemType === 'Series' ? 'tv' : 'movie',
          });
        }
      }
    }
  }

  return Array.from(deduped.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([tmdbId, val]) => ({
      tmdbId,
      count: val.count,
      name: val.name,
      mediaType: val.mediaType,
    }));
}

export async function refreshMostPlayedCache(): Promise<void> {
  const settings = getSettings();

  if (!settings.jellyfin.apiKey || !settings.jellyfin.ip) {
    logger.debug(
      'Skipping most played cache refresh: Jellyfin/Emby not configured',
      { label: 'Jobs' }
    );
    return;
  }

  try {
    logger.info('Refreshing most played cache from Playback Reporting plugin', {
      label: 'Jobs',
    });

    const jellyfinClient = new JellyfinAPI(
      getHostname(),
      settings.jellyfin.apiKey
    );

    const periods: { key: RankingPeriod; days: number }[] = [
      { key: 'week', days: 7 },
      { key: 'month', days: 30 },
      { key: 'year', days: 365 },
    ];

    for (const { key, days } of periods) {
      const sorted = await fetchAndAggregate(jellyfinClient, days);
      mostPlayedCache[key] = { generatedAt: Date.now(), sorted };
      logger.info(`Most played cache refreshed: ${key} - ${sorted.length} entries`, {
        label: 'Jobs',
      });
    }
    saveCacheToDisk();
  } catch (e) {
    logger.error(
      `Failed to refresh most played cache: ${e.message}`,
      { label: 'Jobs' }
    );
  }
}
