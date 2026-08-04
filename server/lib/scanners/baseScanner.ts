import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import { notifyEpisodeUpdated } from '@server/lib/episodeNotification';
import logger from '@server/logger';
import AsyncLock from '@server/utils/asyncLock';
import { randomUUID } from 'crypto';

// Default scan rates (can be overidden)
const BUNDLE_SIZE = 20;
const UPDATE_RATE = 4 * 1000;

export type StatusBase = {
  running: boolean;
  progress: number;
  total: number;
};

export interface RunnableScanner<T> {
  run: () => Promise<void>;
  status: () => T & StatusBase;
}

export interface MediaIds {
  tmdbId: number;
  imdbId?: string;
  tvdbId?: number;
}

interface ProcessOptions {
  mediaAddedAt?: Date;
  jellyfinMediaId?: string;
  imdbId?: string;
  serviceId?: number;
  externalServiceId?: number;
  externalServiceSlug?: string;
  processing?: boolean;
  hasFile?: boolean;
}

/** 单集明细（供 Episode 表 upsert） */
export interface ProcessableEpisode {
  episodeNumber: number;
  jellyfinEpisodeId?: string;
  addedAt?: Date;
}

export interface ProcessableSeason {
  seasonNumber: number;
  totalEpisodes: number;
  episodes: number;
  processing?: boolean;
  /** 该季单集明细（最近添加 / 更新集数用） */
  episodeDetails?: ProcessableEpisode[];
}

class BaseScanner<T> {
  private bundleSize;
  private updateRate;
  protected progress = 0;
  protected items: T[] = [];
  protected totalSize?: number = 0;
  protected scannerName: string;
  protected sessionId: string;
  protected running = false;
  readonly asyncLock = new AsyncLock();
  readonly tmdb = new TheMovieDb();

  protected constructor(
    scannerName: string,
    {
      updateRate,
      bundleSize,
    }: {
      updateRate?: number;
      bundleSize?: number;
    } = {}
  ) {
    this.scannerName = scannerName;
    this.bundleSize = bundleSize ?? BUNDLE_SIZE;
    this.updateRate = updateRate ?? UPDATE_RATE;
  }

  private async getExisting(tmdbId: number, mediaType: MediaType) {
    const mediaRepository = getRepository(Media);

    const existing = await mediaRepository.findOne({
      where: { tmdbId: tmdbId, mediaType },
    });

    return existing;
  }

  protected async processMovie(
    tmdbId: number,
    {
      mediaAddedAt,
      jellyfinMediaId,
      imdbId,
      serviceId,
      externalServiceId,
      externalServiceSlug,
      processing = false,
      hasFile = true,
    }: ProcessOptions = {}
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    await this.asyncLock.dispatch(tmdbId, async () => {
      const existing = await this.getExisting(tmdbId, MediaType.MOVIE);

      if (existing) {
        let changedExisting = false;

        if (existing.status !== MediaStatus.AVAILABLE) {
          const previousStatus = existing.status;

          existing.status =
            !processing && hasFile
              ? MediaStatus.AVAILABLE
              : !processing &&
                  !hasFile &&
                  previousStatus === MediaStatus.PROCESSING
                ? MediaStatus.UNKNOWN
                : processing
                  ? previousStatus === MediaStatus.DELETED
                    ? MediaStatus.DELETED
                    : MediaStatus.PROCESSING
                  : previousStatus;

          if (existing.status !== previousStatus) {
            if (mediaAddedAt) {
              existing.mediaAddedAt = mediaAddedAt;
            }
            changedExisting = true;
          }
        }

        if (!changedExisting && !existing.mediaAddedAt && mediaAddedAt) {
          existing.mediaAddedAt = mediaAddedAt;
          changedExisting = true;
        }

        if (jellyfinMediaId && existing.jellyfinMediaId !== jellyfinMediaId) {
          existing.jellyfinMediaId = jellyfinMediaId;
          changedExisting = true;
        }

        if (imdbId && !existing.imdbId) {
          existing.imdbId = imdbId;
          changedExisting = true;
        }

        if (serviceId !== undefined && existing.serviceId !== serviceId) {
          existing.serviceId = serviceId;
          changedExisting = true;
        }

        if (
          externalServiceId !== undefined &&
          existing.externalServiceId !== externalServiceId
        ) {
          existing.externalServiceId = externalServiceId;
          changedExisting = true;
        }

        if (
          externalServiceSlug !== undefined &&
          existing.externalServiceSlug !== externalServiceSlug
        ) {
          existing.externalServiceSlug = externalServiceSlug;
          changedExisting = true;
        }

        if (changedExisting) {
          await mediaRepository.save(existing);
          this.log(
            `Media already exists. Changes were detected and the title will be updated.`,
            'info'
          );
        } else {
          this.log(`Title already exists and no changes detected`);
        }
      } else {
        if (!processing && !hasFile) {
          return;
        }

        const newMedia = new Media();
        newMedia.tmdbId = tmdbId;
        newMedia.imdbId = imdbId;

        newMedia.status = !processing
          ? MediaStatus.AVAILABLE
          : processing
            ? MediaStatus.PROCESSING
            : MediaStatus.UNKNOWN;
        newMedia.mediaType = MediaType.MOVIE;
        newMedia.serviceId = serviceId;
        newMedia.externalServiceId = externalServiceId;
        newMedia.externalServiceSlug = externalServiceSlug;

        if (mediaAddedAt) {
          newMedia.mediaAddedAt = mediaAddedAt;
        }

        if (jellyfinMediaId) {
          newMedia.jellyfinMediaId = jellyfinMediaId;
        }

        await mediaRepository.save(newMedia);
        this.log(`Saved new media`);
      }
    });
  }

  /**
   * 批量 upsert 单集（Episode 表）
   *
   * 只插不更（orIgnore → sqlite INSERT OR IGNORE / pg ON CONFLICT DO NOTHING），
   * 按 jellyfinEpisodeId 去重；季内已存集数与待插一致时跳过，稳态零写放大。
   */
  protected async upsertEpisodes(
    media: Media,
    seasonNumber: number,
    episodeDetails?: ProcessableEpisode[]
  ): Promise<void> {
    if (!episodeDetails || episodeDetails.length === 0) {
      return;
    }
    const episodeRepository = getRepository(Episode);

    const existingCount = await episodeRepository.count({
      where: { media: { id: media.id }, seasonNumber },
    });
    if (existingCount === episodeDetails.length) {
      return;
    }

    const result = await episodeRepository
      .createQueryBuilder()
      .insert()
      .into(Episode)
      .values(
        episodeDetails.map((detail) => ({
          media,
          seasonNumber,
          episodeNumber: detail.episodeNumber,
          jellyfinEpisodeId: detail.jellyfinEpisodeId,
          addedAt: detail.addedAt ?? new Date(),
        }))
      )
      .orIgnore()
      .execute();
    void result;

    // F1 追更通知：仅在确实新增了集（orIgnore 后计数增加）时触发
    const newCount = await episodeRepository.count({
      where: { media: { id: media.id }, seasonNumber },
    });
    if (newCount > existingCount) {
      await notifyEpisodeUpdated({
        mediaId: media.id,
        tmdbId: media.tmdbId,
        mediaType: media.mediaType,
        newEpisodes: episodeDetails.map((detail) => ({
          seasonNumber,
          episodeNumber: detail.episodeNumber,
          addedAt: detail.addedAt ?? new Date(),
        })),
      });
    }
  }

  protected async processShow(
    tmdbId: number,
    tvdbId: number | undefined,
    seasons: ProcessableSeason[],
    {
      mediaAddedAt,
      jellyfinMediaId,
      serviceId,
      externalServiceId,
      externalServiceSlug,
    }: ProcessOptions = {}
  ): Promise<void> {
    const mediaRepository = getRepository(Media);

    await this.asyncLock.dispatch(tmdbId, async () => {
      const media = await this.getExisting(tmdbId, MediaType.TV);

      const newSeasons: Season[] = [];

      const currentStandardSeasonsAvailable = (
        media?.seasons.filter(
          (season) => season.status === MediaStatus.AVAILABLE
        ) ?? []
      ).length;

      for (const season of seasons) {
        const existingSeason = media?.seasons.find(
          (es) => es.seasonNumber === season.seasonNumber
        );

        if (
          media &&
          season.episodes > 0 &&
          media.jellyfinMediaId !== jellyfinMediaId
        ) {
          media.jellyfinMediaId = jellyfinMediaId;
        }

        if (existingSeason) {
          existingSeason.status =
            (season.totalEpisodes === season.episodes && season.episodes > 0) ||
            existingSeason.status === MediaStatus.AVAILABLE
              ? MediaStatus.AVAILABLE
              : season.episodes > 0
                ? MediaStatus.PARTIALLY_AVAILABLE
                : season.processing &&
                    existingSeason.status !== MediaStatus.DELETED
                  ? MediaStatus.PROCESSING
                  : !season.processing &&
                      season.episodes === 0 &&
                      existingSeason.status === MediaStatus.PROCESSING
                    ? MediaStatus.UNKNOWN
                    : existingSeason.status;
        } else {
          newSeasons.push(
            new Season({
              seasonNumber: season.seasonNumber,
              status:
                season.totalEpisodes === season.episodes && season.episodes > 0
                  ? MediaStatus.AVAILABLE
                  : season.episodes > 0
                    ? MediaStatus.PARTIALLY_AVAILABLE
                    : season.processing
                      ? MediaStatus.PROCESSING
                      : MediaStatus.UNKNOWN,
            })
          );
        }
      }

      if (media) {
        media.seasons = [...media.seasons, ...newSeasons];

        const newStandardSeasonsAvailable = (
          media.seasons.filter(
            (season) => season.status === MediaStatus.AVAILABLE
          ) ?? []
        ).length;

        if (newStandardSeasonsAvailable > currentStandardSeasonsAvailable) {
          this.log(
            `Detected ${
              newStandardSeasonsAvailable - currentStandardSeasonsAvailable
            } new season(s)`,
            'debug'
          );
          media.lastSeasonChange = new Date();

          if (mediaAddedAt) {
            media.mediaAddedAt = mediaAddedAt;
          }
        }

        if (!media.mediaAddedAt && mediaAddedAt) {
          media.mediaAddedAt = mediaAddedAt;
        }

        if (serviceId !== undefined) {
          media.serviceId = serviceId;
        }

        if (externalServiceId !== undefined) {
          media.externalServiceId = externalServiceId;
        }

        if (externalServiceSlug !== undefined) {
          media.externalServiceSlug = externalServiceSlug;
        }

        const nonSpecialSeasons = media.seasons.filter(
          (s) => s.seasonNumber !== 0
        );

        const countsTowardsRollup = (s: Season): boolean => {
          const scannedSeason = seasons.find(
            (season) => season.seasonNumber === s.seasonNumber
          );

          if (scannedSeason) {
            return scannedSeason.totalEpisodes > 0;
          }

          return s.status !== MediaStatus.UNKNOWN;
        };

        const standardSeasonsForRollup = nonSpecialSeasons.filter((s) =>
          countsTowardsRollup(s)
        );
        const isAllStandardSeasonsAvailable =
          standardSeasonsForRollup.length > 0 &&
          standardSeasonsForRollup.every(
            (s) => s.status === MediaStatus.AVAILABLE
          );

        media.status = isAllStandardSeasonsAvailable
          ? MediaStatus.AVAILABLE
          : media.seasons.some(
                (season) =>
                  season.status === MediaStatus.PARTIALLY_AVAILABLE ||
                  season.status === MediaStatus.AVAILABLE
              )
            ? MediaStatus.PARTIALLY_AVAILABLE
            : (!seasons.length && media.status !== MediaStatus.DELETED) ||
                media.seasons.some(
                  (season) => season.status === MediaStatus.PROCESSING
                )
              ? MediaStatus.PROCESSING
              : media.status === MediaStatus.DELETED
                ? MediaStatus.DELETED
                : MediaStatus.UNKNOWN;
        for (const season of seasons) {
          await this.upsertEpisodes(
            media,
            season.seasonNumber,
            season.episodeDetails
          );
        }
        await mediaRepository.save(media);
        this.log(`Updating existing title`);
      } else {
        const nonSpecialNewSeasons = newSeasons.filter(
          (s) => s.seasonNumber !== 0
        );

        const newSeasonsForRollup = nonSpecialNewSeasons.filter(
          (s) =>
            (seasons.find((season) => season.seasonNumber === s.seasonNumber)
              ?.totalEpisodes ?? 0) > 0
        );
        const isAllStandardSeasonsAvailable =
          newSeasonsForRollup.length > 0 &&
          newSeasonsForRollup.every((s) => s.status === MediaStatus.AVAILABLE);

        const newMedia = new Media({
          mediaType: MediaType.TV,
          seasons: newSeasons,
          tmdbId,
          tvdbId,
          mediaAddedAt,
          serviceId,
          externalServiceId,
          externalServiceSlug,
          jellyfinMediaId: newSeasons.some(
            (sn) =>
              sn.status === MediaStatus.PARTIALLY_AVAILABLE ||
              sn.status === MediaStatus.AVAILABLE
          )
            ? jellyfinMediaId
            : undefined,
          status: isAllStandardSeasonsAvailable
            ? MediaStatus.AVAILABLE
            : newSeasons.some(
                  (season) =>
                    season.status === MediaStatus.PARTIALLY_AVAILABLE ||
                    season.status === MediaStatus.AVAILABLE
                )
              ? MediaStatus.PARTIALLY_AVAILABLE
              : newSeasons.some(
                    (season) => season.status === MediaStatus.PROCESSING
                  )
                ? MediaStatus.PROCESSING
                : MediaStatus.UNKNOWN,
        });
        await mediaRepository.save(newMedia);
        for (const season of seasons) {
          await this.upsertEpisodes(
            newMedia,
            season.seasonNumber,
            season.episodeDetails
          );
        }
        this.log(`Saved new series`);
      }
    });
  }

  protected async declineOrphanedRequests(media: Media): Promise<void> {
    if (media.requests === undefined) {
      throw new Error(
        `declineOrphanedRequests called for media ${media.id} without the 'requests' relation loaded`
      );
    }

    const requestRepository = getRepository(MediaRequest);

    const orphanedRequests = (media.requests ?? []).filter(
      (request) => request.status === MediaRequestStatus.APPROVED
    );

    for (const request of orphanedRequests) {
      request.status = MediaRequestStatus.DECLINED;
      request.media = media;
      await requestRepository.save(request);
      this.log(
        `Declined orphaned ${
          media.mediaType === MediaType.MOVIE ? 'movie' : 'series'
        } request ${request.id} for ${media.tmdbId} not found in any download client.`,
        'info'
      );
    }
  }

  protected startRun(): string {
    const sessionId = randomUUID();
    this.sessionId = sessionId;

    this.log('Scan starting', 'info', { sessionId });

    this.running = true;

    return sessionId;
  }

  protected endRun(sessionId: string): void {
    if (this.sessionId === sessionId) {
      this.running = false;
    }
  }

  public cancel(): void {
    this.running = false;
  }

  protected async loop(
    processFn: (item: T) => Promise<void>,
    {
      start = 0,
      sessionId,
    }: {
      start?: number;
      sessionId?: string;
    } = {}
  ): Promise<void> {
    let offset = start;

    while (offset < this.items.length) {
      if (!this.running) {
        throw new Error('Sync was aborted.');
      }

      if (this.sessionId !== sessionId) {
        throw new Error('New session was started. Old session aborted.');
      }

      const slicedItems = this.items.slice(offset, offset + this.bundleSize);
      this.progress = offset;

      await this.processItems(processFn, slicedItems);

      offset += this.bundleSize;

      if (offset < this.items.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  private async processItems(
    processFn: (items: T) => Promise<void>,
    items: T[]
  ) {
    await Promise.all(
      items.map(async (item) => {
        await processFn(item);
      })
    );
  }

  protected log(
    message: string,
    level: 'info' | 'error' | 'debug' | 'warn' = 'debug',
    optional?: Record<string, unknown>
  ): void {
    logger[level](message, { label: this.scannerName, ...optional });
  }

  get protectedUpdateRate(): number {
    return this.updateRate;
  }

  get protectedBundleSize(): number {
    return this.bundleSize;
  }
}

export default BaseScanner;
