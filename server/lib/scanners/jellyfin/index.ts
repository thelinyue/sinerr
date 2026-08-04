import animeList from '@server/api/animelist';
import type {
  JellyfinLibraryItem,
  JellyfinLibraryItemExtended,
} from '@server/api/jellyfin';
import JellyfinAPI from '@server/api/jellyfin';
import { getMetadataProvider } from '@server/api/metadata';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type {
  TmdbKeyword,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  ProcessableEpisode,
  ProcessableSeason,
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import type { Library } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { getHostname } from '@server/utils/getHostname';
import { uniqWith } from 'lodash';

interface JellyfinSyncStatus extends StatusBase {
  currentLibrary: Library;
  libraries: Library[];
}

class JellyfinScanner
  extends BaseScanner<JellyfinLibraryItem>
  implements RunnableScanner<JellyfinSyncStatus>
{
  private jfClient: JellyfinAPI;
  private libraries: Library[];
  private currentLibrary: Library;
  private isRecentOnly = false;
  private processedAnidbSeason: Map<number, Map<number, number>>;

  constructor({ isRecentOnly }: { isRecentOnly?: boolean } = {}) {
    super('Jellyfin Sync');
    this.isRecentOnly = isRecentOnly ?? false;
  }

  private async extractMovieIds(jellyfinitem: JellyfinLibraryItem): Promise<{
    tmdbId: number;
    imdbId?: string;
    metadata: JellyfinLibraryItemExtended;
  } | null> {
    let metadata = await this.jfClient.getItemData(jellyfinitem.Id);

    if (!metadata?.Id) {
      this.log('No Id metadata for this title. Skipping', 'debug', {
        jellyfinItemId: jellyfinitem.Id,
      });
      return null;
    }

    const anidbId = Number(metadata.ProviderIds.AniDB ?? null);
    let tmdbId = Number(
      metadata.ProviderIds.Tmdb || metadata.ProviderIds.TheMovieDb || null
    );
    let imdbId = metadata.ProviderIds.Imdb;

    // We use anidb only if we have the anidbId and nothing else
    if (anidbId && !imdbId && !tmdbId) {
      const result = animeList.getFromAnidbId(anidbId);
      tmdbId = Number(result?.tmdbId ?? null);
      imdbId = result?.imdbId;
    }

    if (imdbId && !tmdbId) {
      const tmdbMovie = await this.tmdb.getMediaByImdbId({
        imdbId: imdbId,
      });
      tmdbId = tmdbMovie.id;
    }

    if (!tmdbId) {
      throw new Error('Unable to find TMDb ID');
    }

    // With AniDB we can have mixed libraries with movies in a "show" library
    // We take the first episode of the first season (the movie) and use it to
    // get more information, like the MediaSource
    if (anidbId && metadata.Type === 'Series') {
      const season = (await this.jfClient.getSeasons(jellyfinitem.Id)).find(
        (md) => {
          return md.IndexNumber === 1;
        }
      );
      if (!season) {
        this.log('No season found for anidb movie', 'debug', {
          jellyfinitem,
        });
        return null;
      }
      const episodes = await this.jfClient.getEpisodes(
        jellyfinitem.Id,
        season.Id
      );
      if (!episodes[0]) {
        this.log('No episode found for anidb movie', 'debug', {
          jellyfinitem,
        });
        return null;
      }
      metadata = await this.jfClient.getItemData(episodes[0].Id);
      if (!metadata) {
        this.log('No metadata found for anidb movie', 'debug', {
          jellyfinitem,
        });
        return null;
      }
    }

    return { tmdbId, imdbId, metadata };
  }

  private async processJellyfinMovie(jellyfinitem: JellyfinLibraryItem) {
    try {
      const extracted = await this.extractMovieIds(jellyfinitem);
      if (!extracted) return;

      const { tmdbId, imdbId, metadata } = extracted;

      const mediaAddedAt = metadata.DateCreated
        ? new Date(metadata.DateCreated)
        : undefined;

      await this.processMovie(tmdbId, {
        mediaAddedAt,
        jellyfinMediaId: metadata.Id,
        imdbId,
      });
    } catch (e) {
      this.log(
        `Failed to process Jellyfin item, id: ${jellyfinitem.Id}`,
        'error',
        {
          errorMessage: e.message,
          jellyfinitem,
        }
      );
    }
  }

  private async getTvShow({
    tmdbId,
    tvdbId,
  }: {
    tmdbId?: number;
    tvdbId?: number;
  }): Promise<TmdbTvDetails> {
    let tvShow;

    if (tmdbId) {
      tvShow = await this.tmdb.getTvShow({
        tvId: Number(tmdbId),
      });
    } else if (tvdbId) {
      tvShow = await this.tmdb.getShowByTvdbId({
        tvdbId: Number(tvdbId),
      });
    } else {
      throw new Error('No ID provided');
    }

    const metadataProvider = tvShow.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');

    if (!(metadataProvider instanceof TheMovieDb)) {
      tvShow = await metadataProvider.getTvShow({
        tvId: Number(tmdbId),
      });
    }

    return tvShow;
  }

  private async processJellyfinShow(jellyfinitem: JellyfinLibraryItem) {
    let tvShow: TmdbTvDetails | null = null;

    try {
      const Id =
        jellyfinitem.SeriesId ?? jellyfinitem.SeasonId ?? jellyfinitem.Id;
      const metadata = await this.jfClient.getItemData(Id);

      if (!metadata?.Id) {
        this.log('No Id metadata for this title. Skipping', 'debug', {
          jellyfinItemId: jellyfinitem.Id,
        });
        return;
      }

      if (metadata.ProviderIds.Tmdb || metadata.ProviderIds.TheMovieDb) {
        try {
          tvShow = await this.getTvShow({
            tmdbId: Number(
              metadata.ProviderIds.Tmdb || metadata.ProviderIds.TheMovieDb
            ),
          });
        } catch {
          this.log('Unable to find TMDb ID for this title.', 'debug', {
            jellyfinitem,
          });
        }
      }

      if (!tvShow && metadata.ProviderIds.Tvdb) {
        try {
          tvShow = await this.getTvShow({
            tvdbId: Number(metadata.ProviderIds.Tvdb),
          });
        } catch {
          this.log('Unable to find TVDb ID for this title.', 'debug', {
            jellyfinitem,
          });
        }
      }

      let tvdbSeasonFromAnidb: number | undefined;
      if (!tvShow && metadata.ProviderIds.AniDB) {
        const anidbId = Number(metadata.ProviderIds.AniDB);
        const result = animeList.getFromAnidbId(anidbId);
        tvdbSeasonFromAnidb = result?.tvdbSeason;
        if (result?.tvdbId) {
          try {
            tvShow = await this.tmdb.getShowByTvdbId({
              tvdbId: result.tvdbId,
            });
          } catch {
            this.log('Unable to find AniDB ID for this title.', 'debug', {
              jellyfinitem,
            });
          }
        }
        // With AniDB we can have mixed libraries with movies in a "show" library
        else if (result?.imdbId || result?.tmdbId) {
          await this.processJellyfinMovie(jellyfinitem);
          return;
        }
      }

      if (tvShow) {
        const seasons = tvShow.seasons;
        const jellyfinSeasons = await this.jfClient.getSeasons(Id);

        const processableSeasons: ProcessableSeason[] = [];

        const settings = getSettings();
        const filteredSeasons = settings.main.enableSpecialEpisodes
          ? seasons
          : seasons.filter((sn) => sn.season_number !== 0);

        for (const season of filteredSeasons) {
          const matchedJellyfinSeason = jellyfinSeasons.find((md) => {
            if (tvdbSeasonFromAnidb) {
              // In AniDB we don't have the concept of seasons,
              // we have multiple shows with only Season 1 (and sometimes a season with index 0 for specials).
              // We use tvdbSeasonFromAnidb to check if we are on the correct TMDB season and
              // md.IndexNumber === 1 to be sure to find the correct season on jellyfin
              return (
                tvdbSeasonFromAnidb === season.season_number &&
                md.IndexNumber === 1
              );
            } else {
              return Number(md.IndexNumber) === season.season_number;
            }
          });

          // Check if we found the matching season and it has all the available episodes
          if (matchedJellyfinSeason) {
            const episodes = await this.jfClient.getEpisodes(
              Id,
              matchedJellyfinSeason.Id
            );
            let totalStandard = 0;
            const seasonDetails: ProcessableEpisode[] = [];

            for (const episode of episodes) {
              let episodeCount = 1;

              if (
                episode.IndexNumber !== undefined &&
                episode.IndexNumberEnd !== undefined
              ) {
                episodeCount = episode.IndexNumberEnd - episode.IndexNumber + 1;
              }

              totalStandard += episodeCount;

              // 多集合并文件只记起始集号
              if (episode.IndexNumber !== undefined) {
                seasonDetails.push({
                  episodeNumber: episode.IndexNumber,
                  jellyfinEpisodeId: episode.Id,
                  addedAt: (episode as JellyfinLibraryItemExtended).DateCreated
                    ? new Date(
                        (episode as JellyfinLibraryItemExtended)
                          .DateCreated as string
                      )
                    : undefined,
                });
              }
            }

            // With AniDB we can have multiple shows for one season, so we need to save
            // the episode from all the jellyfin entries to get the total
            if (tvdbSeasonFromAnidb) {
              let show = this.processedAnidbSeason.get(tvShow.id);

              if (!show) {
                show = new Map([[season.season_number, totalStandard]]);
                this.processedAnidbSeason.set(tvShow.id, show);
              } else {
                const currentCount = show.get(season.season_number) ?? 0;
                const newCount = currentCount + totalStandard;
                show.set(season.season_number, newCount);
                totalStandard = newCount;
              }
            }

            processableSeasons.push({
              seasonNumber: season.season_number,
              totalEpisodes: season.episode_count,
              episodes: totalStandard,
              episodeDetails: seasonDetails,
            });
          } else {
            processableSeasons.push({
              seasonNumber: season.season_number,
              totalEpisodes: season.episode_count,
              episodes: 0,
            });
          }
        }

        await this.processShow(
          tvShow.id,
          tvShow.external_ids?.tvdb_id,
          processableSeasons,
          {
            mediaAddedAt: metadata.DateCreated
              ? new Date(metadata.DateCreated)
              : undefined,
            jellyfinMediaId: Id,
          }
        );
      } else {
        this.log(
          `No information found for the show: ${metadata.Name}`,
          'debug',
          {
            jellyfinitem,
          }
        );
      }
    } catch (e) {
      this.log(
        `Failed to process Jellyfin item. Id: ${
          jellyfinitem.SeriesId ?? jellyfinitem.SeasonId ?? jellyfinitem.Id
        }`,
        'error',
        { errorMessage: e.message, jellyfinitem }
      );
    }
  }

  private async processItem(item: JellyfinLibraryItem): Promise<void> {
    if (item.Type === 'Movie') {
      await this.processJellyfinMovie(item);
    } else if (item.Type === 'Series') {
      await this.processJellyfinShow(item);
    } else if (item.Type === 'Episode') {
      // recent scan 的 /Items/Latest 可能以单集为代表项，按 SeriesId 走剧集处理，
      // 确保「仅新增单集」也能触发 processShow（Episode 表同步到秒级~分钟级）
      await this.processJellyfinShow(item);
    }
  }

  public async run(): Promise<void> {
    const settings = getSettings();

    if (
      settings.main.mediaServerType != MediaServerType.JELLYFIN &&
      settings.main.mediaServerType != MediaServerType.EMBY
    ) {
      return;
    }

    const sessionId = this.startRun();

    try {
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
        order: { id: 'ASC' },
      });

      if (!admin) {
        return this.log('No admin configured. Jellyfin sync skipped.', 'warn');
      }

      this.jfClient = new JellyfinAPI(
        getHostname(),
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId
      );

      this.jfClient.setUserId(admin.jellyfinUserId ?? '');

      this.libraries = settings.jellyfin.libraries.filter(
        (library) => library.enabled
      );

      await animeList.sync();

      if (this.isRecentOnly) {
        for (const library of this.libraries) {
          this.currentLibrary = library;
          // Reset AniDB season tracking per library
          this.processedAnidbSeason = new Map();
          this.log(
            `Beginning to process recently added for library: ${library.name}`,
            'info'
          );
          const libraryItems = await this.jfClient.getRecentlyAdded(library.id);

          // Bundle items up by rating keys
          this.items = uniqWith(libraryItems, (mediaA, mediaB) => {
            if (mediaA.SeriesId && mediaB.SeriesId) {
              return mediaA.SeriesId === mediaB.SeriesId;
            }

            if (mediaA.SeasonId && mediaB.SeasonId) {
              return mediaA.SeasonId === mediaB.SeasonId;
            }

            return mediaA.Id === mediaB.Id;
          });

          await this.loop(this.processItem.bind(this), { sessionId });
        }
      } else {
        for (const library of this.libraries) {
          this.currentLibrary = library;
          // Reset AniDB season tracking per library
          this.processedAnidbSeason = new Map();
          this.log(`Beginning to process library: ${library.name}`, 'info');
          this.items = await this.jfClient.getLibraryContents(library.id);
          await this.loop(this.processItem.bind(this), { sessionId });
        }
      }

      this.log(
        this.isRecentOnly
          ? 'Recently Added Scan Complete'
          : 'Full Scan Complete',
        'info'
      );
    } catch (e) {
      this.log('Sync interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.endRun(sessionId);
    }
  }

  /**
   * 精准刷新单个媒体（webhook library.new / item.updated 触发）
   *
   * 按 ItemId 反查该媒体，只处理这一部剧/电影（剧集/季自动解析到整部剧），
   * 复用 processShow 的 Episode 表同步逻辑，避免每次新入库都触发全库最近扫描。
   * 返回 false 表示已有扫描在运行、配置缺失或媒体不存在（不做全库回退，交给定时扫描兜底）。
   */
  public async processMediaItem(itemId: string): Promise<boolean> {
    const settings = getSettings();

    if (
      settings.main.mediaServerType != MediaServerType.JELLYFIN &&
      settings.main.mediaServerType != MediaServerType.EMBY
    ) {
      return false;
    }

    if (this.running) {
      return false;
    }

    const sessionId = this.startRun();

    try {
      const userRepository = getRepository(User);
      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
        order: { id: 'ASC' },
      });

      if (!admin) {
        this.log('No admin configured. Jellyfin sync skipped.', 'warn');
        return false;
      }

      this.jfClient = new JellyfinAPI(
        getHostname(),
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId
      );
      this.jfClient.setUserId(admin.jellyfinUserId ?? '');

      this.libraries = settings.jellyfin.libraries.filter(
        (library) => library.enabled
      );
      this.processedAnidbSeason = new Map();

      const item = await this.jfClient.getItemData(itemId);
      if (!item?.Id) {
        this.log(
          `No item found for Id: ${itemId}. Skipping targeted refresh`,
          'warn'
        );
        return false;
      }

      this.log(
        `Precisely refreshing media item: ${item.Name ?? itemId} (${item.Type})`,
        'info'
      );

      if (item.Type === 'Movie') {
        await this.processJellyfinMovie(item);
      } else if (
        item.Type === 'Series' ||
        item.Type === 'Season' ||
        item.Type === 'Episode'
      ) {
        // 剧集/季/单集统一走剧集处理（内部按 SeriesId 解析到整部剧）
        await this.processJellyfinShow(item);
      } else {
        this.log(
          `Unsupported item type for targeted refresh: ${item.Type}`,
          'debug'
        );
      }

      this.log('Targeted media refresh complete', 'info');
      return true;
    } catch (e) {
      this.log('Targeted media refresh failed', 'error', {
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return false;
    } finally {
      this.endRun(sessionId);
    }
  }

  public status(): JellyfinSyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
      currentLibrary: this.currentLibrary,
      libraries: this.libraries,
    };
  }
}

export const jellyfinFullScanner = new JellyfinScanner();
export const jellyfinRecentScanner = new JellyfinScanner({
  isRecentOnly: true,
});
