import MoviePilotAPI, {
  type MoviePilotSeerrOptions,
  type MoviePilotSubscription,
} from '@server/api/moviepilot';
import TheMovieDb from '@server/api/themoviedb';
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
import { completeRequestForMoviePilot } from '@server/lib/moviePilotSync';
import notificationManager, { Notification } from '@server/lib/notifications';
import type { MoviePilotServerSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { truncate } from 'lodash';
import type {
  EntityManager,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { EventSubscriber, Not } from 'typeorm';

@EventSubscriber()
export class MediaRequestSubscriber implements EntitySubscriberInterface<MediaRequest> {
  private async notifyAvailableMovie(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
      });
    }

    if (!latestMedia || latestMedia.status !== MediaStatus.AVAILABLE) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const movie = await tmdb.getMovie({
        movieId: entity.media.tmdbId,
      });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Movie Request Now Available',
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        subject: `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`,
        message: truncate(movie.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        media: latestMedia,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  private async notifyAvailableSeries(
    entity: MediaRequest,
    event?: UpdateEvent<MediaRequest>
  ) {
    let latestMedia: Media | null = null;
    if (event?.manager) {
      latestMedia = await event.manager.findOne(Media, {
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }
    if (!latestMedia) {
      const mediaRepository = getRepository(Media);
      latestMedia = await mediaRepository.findOne({
        where: { id: entity.media.id },
        relations: { seasons: true },
      });
    }

    if (!latestMedia) {
      return;
    }

    const requestedSeasons =
      entity.seasons?.map((entitySeason) => entitySeason.seasonNumber) ?? [];
    const availableSeasons = latestMedia.seasons.filter(
      (season) =>
        season.status === MediaStatus.AVAILABLE &&
        requestedSeasons.includes(season.seasonNumber)
    );
    const isMediaAvailable =
      availableSeasons.length > 0 &&
      availableSeasons.length === requestedSeasons.length;

    if (!isMediaAvailable) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const tv = await tmdb.getTvShow({ tvId: entity.media.tmdbId });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: 'Series Request Now Available',
        subject: `${tv.name}${
          tv.first_air_date ? ` (${tv.first_air_date.slice(0, 4)})` : ''
        }`,
        message: truncate(tv.overview, {
          length: 500,
          separator: /\s/,
          omission: '…',
        }),
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: entity.requestedBy,
        image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
        media: latestMedia,
        extra: [
          {
            name: 'Requested Seasons',
            value: entity.seasons
              .map((season) => season.seasonNumber)
              .join(', '),
          },
        ],
        request: entity,
      });
    } catch (e) {
      logger.error('Something went wrong sending media notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
        mediaId: entity.id,
      });
    }
  }

  /**
   * 选择 MoviePilot 服务器：优先使用请求级覆盖的服务器（entity.serverId），
   * 否则回退到默认服务器。
   */
  private getMoviePilotServer(
    entity: MediaRequest
  ): MoviePilotServerSettings | undefined {
    const settings = getSettings();
    if (settings.moviepilot.length === 0) {
      return undefined;
    }

    if (entity.serverId !== undefined && entity.serverId !== null) {
      const override = settings.moviepilot.find(
        (m) => m.id === entity.serverId
      );
      if (override) {
        return override;
      }
    }

    return (
      settings.moviepilot.find((m) => m.isDefault) ?? settings.moviepilot[0]
    );
  }

  /**
   * 通过 MoviePilot 的 seerr 兼容端点推送订阅并记录结果。
   * 该端点异步创建订阅（响应先返回、订阅在 MoviePilot 后台任务中创建）。
   */
  private async pushMoviePilotSeerr(
    moviepilot: MoviePilotAPI,
    entity: MediaRequest,
    options: MoviePilotSeerrOptions
  ): Promise<void> {
    await moviepilot.subscribeViaSeerrWebhook(options);
    logger.info('Sent subscription to MoviePilot (via seerr webhook)', {
      label: 'Media Request',
      requestId: entity.id,
      mediaId: entity.media.id,
      tmdbId: options.tmdbid,
      seasons: options.seasons,
      username: options.username,
    });
  }

  public async sendToMoviePilot(entity: MediaRequest): Promise<void> {
    if (entity.status === MediaRequestStatus.APPROVED) {
      try {
        const server = this.getMoviePilotServer(entity);
        if (!server) {
          return;
        }

        const tmdb = new TheMovieDb();
        const moviepilot = new MoviePilotAPI({
          url: MoviePilotAPI.buildUrl(server),
          apiKey: server.apiKey,
        });

        const tmdbId = entity.media.tmdbId;

        // 订阅用户名显示为提交者（来源标注）：如 `linyue (Sinerr)`。
        // seerr 端点会取载荷里的 requestedBy_username 作为订阅的 username 字段。
        // 名字解析：优先 displayName（nickname || username || jellyfinUsername || email），
        // 用 || 而非 ?? 以处理空字符串（Jellyfin 用户 username 可能为空串）。
        const requesterName =
          entity.requestedBy?.displayName ||
          entity.requestedBy?.username ||
          entity.requestedBy?.jellyfinUsername ||
          '';
        const sinerrUsername = requesterName
          ? `${requesterName} (Sinerr)`
          : 'Sinerr';

        // 推送前的去重预检：查询 MoviePilot 中该媒体的既有订阅。
        // MoviePilot 服务端按 tmdbid+season+media_source 精确去重，跨媒体源（如豆瓣来源）
        // 会绕过去重，因此这里按 tmdbid 匹配——只要已存在订阅即视为"已订阅"。
        let existingSubscriptions: MoviePilotSubscription[] = [];
        try {
          existingSubscriptions =
            await moviepilot.getSubscriptionsByTmdbId(tmdbId);
        } catch (e) {
          logger.warn('Failed to query MoviePilot existing subscriptions', {
            label: 'Media Request',
            requestId: entity.id,
            tmdbId,
            errorMessage: e.message,
          });
        }

        // 已订阅且完成（state === 'S'）→ 请求直接置为 COMPLETED，不再走 PROCESSING。
        // 全部完成时无需再推送订阅；部分季完成时对应季已被下方跳过逻辑排除。
        const fullyCompleted = await completeRequestForMoviePilot(
          entity,
          existingSubscriptions
        );
        if (fullyCompleted) {
          return;
        }

        const existingSeasons = new Set(
          existingSubscriptions
            .map((sub) => sub.season)
            .filter(
              (season): season is number =>
                season !== null && season !== undefined
            )
        );

        if (entity.type === MediaType.MOVIE) {
          if (existingSubscriptions.length > 0) {
            logger.info('Movie already subscribed in MoviePilot, skipped', {
              label: 'Media Request',
              requestId: entity.id,
              tmdbId,
            });
            return;
          }

          const movie = await tmdb.getMovie({ movieId: tmdbId });
          try {
            await this.pushMoviePilotSeerr(moviepilot, entity, {
              tmdbid: tmdbId,
              type: 'movie',
              title: movie.title,
              username: sinerrUsername,
            });
          } catch (e) {
            logger.warn('Failed to send movie subscription to MoviePilot', {
              label: 'Media Request',
              requestId: entity.id,
              tmdbId,
              errorMessage: e.message,
            });
          }
        } else {
          const tv = await tmdb.getTvShow({ tvId: tmdbId });
          const name = tv.name;

          const seasons = entity.seasons?.map((s) => s.seasonNumber) ?? [];
          // 只推送 MoviePilot 中尚未订阅的季，已订阅的季直接跳过。
          const missingSeasons = seasons.filter(
            (season) => !existingSeasons.has(season)
          );
          const skippedSeasons = seasons.filter((season) =>
            existingSeasons.has(season)
          );

          if (skippedSeasons.length > 0) {
            logger.info('Seasons already subscribed in MoviePilot, skipped', {
              label: 'Media Request',
              requestId: entity.id,
              tmdbId,
              seasons: skippedSeasons,
            });
          }

          if (missingSeasons.length > 0) {
            try {
              await this.pushMoviePilotSeerr(moviepilot, entity, {
                tmdbid: tmdbId,
                type: 'tv',
                title: name,
                username: sinerrUsername,
                seasons: missingSeasons,
              });
            } catch (e) {
              logger.warn('Failed to send series subscription to MoviePilot', {
                label: 'Media Request',
                requestId: entity.id,
                tmdbId,
                seasons: missingSeasons,
                errorMessage: e.message,
              });
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to send request to MoviePilot', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
          errorMessage: e.message,
        });
      }
    }
  }

  public async removeFromMoviePilot(entity: MediaRequest): Promise<void> {
    try {
      const server = this.getMoviePilotServer(entity);
      if (!server) {
        return;
      }

      const moviepilot = new MoviePilotAPI({
        url: MoviePilotAPI.buildUrl(server),
        apiKey: server.apiKey,
      });

      if (
        entity.type === MediaType.TV &&
        entity.seasons &&
        entity.seasons.length > 0
      ) {
        for (const season of entity.seasons) {
          try {
            await moviepilot.deleteSubscribe(
              entity.media.tmdbId,
              season.seasonNumber
            );
            logger.info('Removed season subscription from MoviePilot', {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              tmdbId: entity.media.tmdbId,
              season: season.seasonNumber,
            });
          } catch (e) {
            logger.warn(
              'Failed to remove season subscription from MoviePilot',
              {
                label: 'Media Request',
                requestId: entity.id,
                tmdbId: entity.media.tmdbId,
                season: season.seasonNumber,
                errorMessage: e.message,
              }
            );
          }
        }
      } else {
        try {
          await moviepilot.deleteSubscribe(entity.media.tmdbId);
          logger.info('Removed subscription from MoviePilot', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tmdbId: entity.media.tmdbId,
          });
        } catch (e) {
          logger.warn('Failed to remove subscription from MoviePilot', {
            label: 'Media Request',
            requestId: entity.id,
            tmdbId: entity.media.tmdbId,
            errorMessage: e.message,
          });
        }
      }
    } catch (e) {
      logger.error('Unexpected error in removeFromMoviePilot', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
        tmdbId: entity.media.tmdbId,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }

  public async updateParentStatus(entity: MediaRequest): Promise<void> {
    const mediaRepository = getRepository(Media);
    const media = await mediaRepository.findOne({
      where: { id: entity.media.id },
    });
    if (!media) {
      logger.error('Media data not found', {
        label: 'Media Request',
        requestId: entity.id,
        mediaId: entity.media.id,
      });
      return;
    }

    const seasonRequestRepository = getRepository(SeasonRequest);
    const requestRepository = getRepository(MediaRequest);

    if (
      entity.status === MediaRequestStatus.APPROVED &&
      media.status !== MediaStatus.AVAILABLE &&
      media.status !== MediaStatus.PARTIALLY_AVAILABLE &&
      media.status !== MediaStatus.PROCESSING
    ) {
      media.status = MediaStatus.PROCESSING;
      await mediaRepository.save(media);
    }

    if (
      media.mediaType === MediaType.MOVIE &&
      entity.status === MediaRequestStatus.DECLINED &&
      media.status !== MediaStatus.DELETED
    ) {
      media.status = MediaStatus.UNKNOWN;
      await mediaRepository.save(media);
    }

    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED &&
      media.status === MediaStatus.PENDING
    ) {
      const pendingCount = await requestRepository.count({
        where: {
          media: { id: media.id },
          status: MediaRequestStatus.PENDING,
          id: Not(entity.id),
        },
      });

      if (pendingCount === 0) {
        const freshMedia = await mediaRepository.findOne({
          where: { id: media.id },
        });
        if (freshMedia) {
          freshMedia.status = MediaStatus.UNKNOWN;
          await mediaRepository.save(freshMedia);
        }
      }
    }

    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED
    ) {
      const seasonRepository = getRepository(Season);
      const actualSeasons = await seasonRepository.find({
        where: { media: { id: media.id } },
      });

      for (const seasonRequest of entity.seasons) {
        seasonRequest.status = MediaRequestStatus.DECLINED;
        await seasonRequestRepository.save(seasonRequest);

        const season = actualSeasons.find(
          (s) => s.seasonNumber === seasonRequest.seasonNumber
        );

        if (season && season.status === MediaStatus.PENDING) {
          const otherActiveRequests = await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.seasons', 'season')
            .where('request.mediaId = :mediaId', { mediaId: media.id })
            .andWhere('request.id != :requestId', { requestId: entity.id })
            .andWhere('request.status NOT IN (:...statuses)', {
              statuses: [
                MediaRequestStatus.DECLINED,
                MediaRequestStatus.COMPLETED,
              ],
            })
            .andWhere('season.seasonNumber = :seasonNumber', {
              seasonNumber: season.seasonNumber,
            })
            .getCount();

          if (otherActiveRequests === 0) {
            season.status = MediaStatus.UNKNOWN;
            await seasonRepository.save(season);
          }
        }
      }
    }

    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.APPROVED
    ) {
      for (const season of entity.seasons) {
        season.status = MediaRequestStatus.APPROVED;
        await seasonRequestRepository.save(season);
      }
    }
  }

  public async handleRemoveParentUpdate(
    manager: EntityManager,
    entity: MediaRequest
  ): Promise<void> {
    const fullMedia = await manager.findOneOrFail(Media, {
      where: { id: entity.media.id },
      relations: { requests: true },
    });

    const hasActive = fullMedia.requests.some(
      (request) =>
        request.status !== MediaRequestStatus.COMPLETED &&
        request.status !== MediaRequestStatus.DECLINED
    );

    const needsStatusUpdate =
      !hasActive &&
      fullMedia.status !== MediaStatus.AVAILABLE &&
      fullMedia.status !== MediaStatus.PARTIALLY_AVAILABLE;

    if (needsStatusUpdate) {
      const cleanMedia = await manager.findOneOrFail(Media, {
        where: { id: entity.media.id },
      });

      const hadCompleted = fullMedia.requests.some(
        (r) => r.status === MediaRequestStatus.COMPLETED
      );
      cleanMedia.status = hadCompleted
        ? MediaStatus.DELETED
        : MediaStatus.UNKNOWN;

      await manager.save(cleanMedia);
    }
  }

  public async afterUpdate(event: UpdateEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToMoviePilot(event.entity as MediaRequest);
    } catch (e) {
      logger.error(
        'Error while sending to MoviePilot in afterUpdate subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);

      if (event.entity.status === MediaRequestStatus.COMPLETED) {
        if (event.entity.media.mediaType === MediaType.MOVIE) {
          await this.notifyAvailableMovie(event.entity as MediaRequest, event);
        }
        if (event.entity.media.mediaType === MediaType.TV) {
          await this.notifyAvailableSeries(event.entity as MediaRequest, event);
        }
      }
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterUpdate subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public async afterInsert(event: InsertEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToMoviePilot(event.entity as MediaRequest);
    } catch (e) {
      logger.error(
        'Error while sending to MoviePilot in afterInsert subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }

    try {
      await this.updateParentStatus(event.entity as MediaRequest);
    } catch (e) {
      logger.error(
        'Error while updating parent status in afterInsert subscriber',
        {
          label: 'Media Request',
          requestId: (event.entity as MediaRequest).id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public async afterRemove(event: RemoveEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    await this.handleRemoveParentUpdate(
      event.manager as EntityManager,
      event.entity as MediaRequest
    );

    await this.removeFromMoviePilot(event.entity as MediaRequest);
  }

  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
