import type { JellyfinLibraryItem } from '@server/api/jellyfin';
import JellyfinAPI from '@server/api/jellyfin';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbTvDetails } from '@server/api/themoviedb/interfaces';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import type Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';

class AvailabilitySync {
  public running = false;

  private jellyfinClient: JellyfinAPI;
  private jellyfinSeasonsCache: Record<string, JellyfinLibraryItem[]>;
  private jellyfinEpisodeExistsCache: Record<string, boolean>;

  readonly tmdb = new TheMovieDb();

  async run() {
    const settings = getSettings();
    const mediaServerType = getSettings().main.mediaServerType;
    this.running = true;
    this.jellyfinSeasonsCache = {};
    this.jellyfinEpisodeExistsCache = {};

    try {
      logger.info('Starting availability sync...', {
        label: 'AvailabilitySync',
      });
      const pageSize = 50;

      const userRepository = getRepository(User);

      const admin = await userRepository.findOne({
        where: { id: 1 },
        select: ['id', 'jellyfinUserId', 'jellyfinDeviceId'],
        order: { id: 'ASC' },
      });

      if (admin) {
        this.jellyfinClient = new JellyfinAPI(
          getHostname(),
          settings.jellyfin.apiKey,
          admin.jellyfinDeviceId
        );

        this.jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

        try {
          await this.jellyfinClient.getSystemInfo();
        } catch (e) {
          logger.error('Sync interrupted.', {
            label: 'AvailabilitySync',
            status: e.statusCode,
            error: e.name,
            errorMessage: e.errorCode,
          });

          this.running = false;
          return;
        }
      } else {
        logger.error('Jellyfin admin is not configured.');

        this.running = false;
        return;
      }

      for await (const media of this.loadAvailableMediaPaginated(pageSize)) {
        if (!this.running) {
          throw new Error('Job aborted');
        }

        if (media.mediaType === 'movie') {
          let movieExists = false;

          const { existsInJellyfin } = await this.mediaExistsInJellyfin(media);

          if (existsInJellyfin) {
            movieExists = true;
            logger.debug(
              `The movie [TMDB ID ${media.tmdbId}] still exists. Preventing removal.`,
              {
                label: 'AvailabilitySync',
              }
            );
          }

          if (!movieExists && media.status === MediaStatus.AVAILABLE) {
            await this.mediaUpdater(media, mediaServerType);
          }
        }

        if (media.mediaType === 'tv') {
          let showExists = false;

          const {
            existsInJellyfin,
            seasonsMap: jellyfinSeasonsMap = new Map(),
          } = await this.mediaExistsInJellyfin(media);

          if (existsInJellyfin) {
            showExists = true;
            logger.debug(
              `The show [TMDB ID ${media.tmdbId}] still exists. Preventing removal.`,
              {
                label: 'AvailabilitySync',
              }
            );
          }

          const filteredSeasonsMap: Map<number, boolean> = new Map();
          media.seasons
            .filter(
              (season) =>
                season.status === MediaStatus.AVAILABLE ||
                season.status === MediaStatus.PARTIALLY_AVAILABLE
            )
            .forEach((season) =>
              filteredSeasonsMap.set(season.seasonNumber, false)
            );

          const finalSeasons: Map<number, boolean> = new Map([
            ...filteredSeasonsMap,
            ...jellyfinSeasonsMap,
          ]);

          let tvShow: TmdbTvDetails | undefined;
          try {
            if (media.tmdbId) {
              tvShow = await this.tmdb.getTvShow({
                tvId: Number(media.tmdbId),
              });
            } else if (media.tvdbId) {
              tvShow = await this.tmdb.getShowByTvdbId({
                tvdbId: Number(media.tvdbId),
              });
            }
          } catch (e) {
            logger.debug(
              `Failed to fetch TMDB data for show [TMDB ID ${media.tmdbId}]. Skipping season enrichment.`,
              { label: 'AvailabilitySync', errorMessage: e.message }
            );
          }

          if (tvShow) {
            media.seasons.forEach((season) => {
              if (season.seasonNumber === 0) {
                return;
              }
              if (
                !finalSeasons.has(season.seasonNumber) &&
                tvShow.seasons.find(
                  (s) => s.season_number === season.seasonNumber
                )?.episode_count
              ) {
                finalSeasons.set(season.seasonNumber, false);
              }
            });
          }

          if (
            !showExists &&
            (media.status === MediaStatus.AVAILABLE ||
              media.status === MediaStatus.PARTIALLY_AVAILABLE ||
              media.seasons.some(
                (season) => season.status === MediaStatus.AVAILABLE
              ) ||
              media.seasons.some(
                (season) => season.status === MediaStatus.PARTIALLY_AVAILABLE
              ))
          ) {
            await this.mediaUpdater(media, mediaServerType);
          }

          if ([...finalSeasons.values()].includes(false)) {
            await this.seasonUpdater(media, finalSeasons, mediaServerType);
          }
        }
      }
    } catch (ex) {
      logger.error('Failed to complete availability sync.', {
        errorMessage: ex.message,
        label: 'AvailabilitySync',
      });
    } finally {
      logger.info('Availability sync complete.', {
        label: 'AvailabilitySync',
      });
      this.running = false;
    }
  }

  public cancel() {
    this.running = false;
  }

  private async *loadAvailableMediaPaginated(pageSize: number) {
    let offset = 0;
    const mediaRepository = getRepository(Media);
    const whereOptions = [
      { status: MediaStatus.AVAILABLE },
      { status: MediaStatus.PARTIALLY_AVAILABLE },
      { seasons: { status: MediaStatus.AVAILABLE } },
      { seasons: { status: MediaStatus.PARTIALLY_AVAILABLE } },
    ];

    let mediaPage: Media[];

    do {
      yield* (mediaPage = await mediaRepository.find({
        where: whereOptions,
        skip: offset,
        take: pageSize,
        relations: { seasons: true },
      }));
      offset += pageSize;
    } while (mediaPage.length > 0);
  }

  private async mediaUpdater(
    media: Media,
    mediaServerType: MediaServerType
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    try {
      let isMediaProcessing = false;

      const requestRepository = getRepository(MediaRequest);

      const request = await requestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .where('(media.id = :id)', {
          id: media.id,
        })
        .andWhere('(request.status = :requestStatus)', {
          requestStatus: MediaRequestStatus.APPROVED,
        })
        .getOne();

      if (request) {
        isMediaProcessing = true;
      }

      media.status = MediaStatus.DELETED;
      media.serviceId = isMediaProcessing ? media.serviceId : null;
      media.externalServiceId = isMediaProcessing
        ? media.externalServiceId
        : null;
      media.externalServiceSlug = isMediaProcessing
        ? media.externalServiceSlug
        : null;
      media.jellyfinMediaId = isMediaProcessing ? media.jellyfinMediaId : null;
      logger.debug(
        `The ${
          media.mediaType === 'movie' ? 'movie' : 'show'
        } [TMDB ID ${media.tmdbId}] was not found in the ${
          mediaServerType === MediaServerType.JELLYFIN ? 'jellyfin' : 'emby'
        } media server. Status will be changed to deleted.`,
        { label: 'AvailabilitySync' }
      );

      await mediaRepository.save(media);
    } catch (ex) {
      logger.debug(
        `Failure updating the ${
          media.mediaType === 'tv' ? 'show' : 'movie'
        } [TMDB ID ${media.tmdbId}].`,
        {
          errorMessage: ex.message,
          label: 'AvailabilitySync',
        }
      );
    }
  }

  private async seasonUpdater(
    media: Media,
    seasons: Map<number, boolean>,
    mediaServerType: MediaServerType
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    const seasonsPendingRemoval = new Map(
      [...seasons].filter(([, exists]) => !exists)
    );
    const seasonKeys = [...seasonsPendingRemoval.keys()];
    const nonSpecialSeasonKeys = seasonKeys.filter((key) => key !== 0);

    try {
      for (const mediaSeason of media.seasons) {
        if (
          seasonsPendingRemoval.has(mediaSeason.seasonNumber) &&
          (mediaSeason.status === MediaStatus.AVAILABLE ||
            mediaSeason.status === MediaStatus.PARTIALLY_AVAILABLE)
        ) {
          mediaSeason.status = MediaStatus.DELETED;
        }
      }

      if (
        nonSpecialSeasonKeys.length > 0 &&
        media.status === MediaStatus.AVAILABLE
      ) {
        media.status = MediaStatus.PARTIALLY_AVAILABLE;
        logger.debug(
          `Marking the show [TMDB ID ${media.tmdbId}] as PARTIALLY_AVAILABLE because season(s) [${nonSpecialSeasonKeys}] was not found in the ${
            mediaServerType === MediaServerType.JELLYFIN ? 'jellyfin' : 'emby'
          } media server.`,
          { label: 'AvailabilitySync' }
        );
      }

      media.lastSeasonChange = new Date();
      await mediaRepository.save(media);
    } catch (ex) {
      logger.debug(
        `Failure updating the season(s) [${seasonKeys}], TMDB ID ${media.tmdbId}.`,
        {
          errorMessage: ex.message,
          label: 'AvailabilitySync',
        }
      );
    }
  }

  private async mediaExistsInJellyfin(
    media: Media
  ): Promise<{ existsInJellyfin: boolean; seasonsMap?: Map<number, boolean> }> {
    const ratingKey = media.jellyfinMediaId;
    let existsInJellyfin = false;
    const preventSeasonSearch = false;

    try {
      let jellyfinMedia: JellyfinLibraryItem | undefined;

      if (ratingKey) {
        jellyfinMedia = await this.jellyfinClient?.getItemData(ratingKey);

        if (media.mediaType === 'tv' && jellyfinMedia !== undefined) {
          this.jellyfinSeasonsCache[ratingKey] =
            await this.jellyfinClient?.getSeasons(ratingKey);
        }
      }

      if (jellyfinMedia) {
        existsInJellyfin = true;
      }
    } catch (ex) {
      logger.debug(
        `Failure retrieving the ${
          media.mediaType === 'tv' ? 'show' : 'movie'
        } [TMDB ID ${media.tmdbId}] from Jellyfin.`,
        {
          errorMessage: ex.message,
          label: 'AvailabilitySync',
        }
      );
    }

    if (media.mediaType === 'tv') {
      const seasonsMap: Map<number, boolean> = new Map();

      if (!preventSeasonSearch) {
        const filteredSeasons = media.seasons.filter(
          (season) =>
            season.status === MediaStatus.AVAILABLE ||
            season.status === MediaStatus.PARTIALLY_AVAILABLE
        );

        for (const season of filteredSeasons) {
          const seasonExists = await this.seasonExistsInJellyfin(media, season);

          if (seasonExists) {
            seasonsMap.set(season.seasonNumber, true);
          }
        }
      }

      return { existsInJellyfin, seasonsMap };
    }

    return { existsInJellyfin };
  }

  private async seasonExistsInJellyfin(
    media: Media,
    season: Season
  ): Promise<boolean> {
    const ratingKey = media.jellyfinMediaId;
    let seasonExistsInJellyfin = false;

    let jellyfinSeasons: JellyfinLibraryItem[] | undefined;

    if (ratingKey) {
      jellyfinSeasons = this.jellyfinSeasonsCache[ratingKey];
    }

    const seasonMeta = jellyfinSeasons?.find(
      (jellyfinSeason) => jellyfinSeason.IndexNumber === season.seasonNumber
    );

    if (seasonMeta) {
      if (ratingKey) {
        const cacheKey = `${ratingKey}-${seasonMeta.Id}`;

        if (cacheKey in this.jellyfinEpisodeExistsCache) {
          seasonExistsInJellyfin = this.jellyfinEpisodeExistsCache[cacheKey];
        } else {
          try {
            const episodes = await this.jellyfinClient.getEpisodes(
              ratingKey,
              seasonMeta.Id
            );

            seasonExistsInJellyfin = episodes.length > 0;
          } catch {
            seasonExistsInJellyfin = true;
          }

          this.jellyfinEpisodeExistsCache[cacheKey] = seasonExistsInJellyfin;
        }
      }
    }

    return seasonExistsInJellyfin;
  }
}

const availabilitySync = new AvailabilitySync();

export default availabilitySync;
