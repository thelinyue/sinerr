import MediaryAPI from '@server/api/mediary';
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
import notificationManager, { Notification } from '@server/lib/notifications';
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
    // Get fresh media state using event manager
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

    // Check availability using fresh media state
    if (
      !latestMedia ||
      latestMedia[entity.is4k ? 'status4k' : 'status'] !== MediaStatus.AVAILABLE
    ) {
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      const movie = await tmdb.getMovie({
        movieId: entity.media.tmdbId,
      });

      notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
        event: `${entity.is4k ? '4K ' : ''}Movie Request Now Available`,
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
    // Get fresh media state with seasons using event manager
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

    // Check availability using fresh media state
    const requestedSeasons =
      entity.seasons?.map((entitySeason) => entitySeason.seasonNumber) ?? [];
    const availableSeasons = latestMedia.seasons.filter(
      (season) =>
        season[entity.is4k ? 'status4k' : 'status'] === MediaStatus.AVAILABLE &&
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
        event: `${entity.is4k ? '4K ' : ''}Series Request Now Available`,
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





  public async sendToMediary(entity: MediaRequest): Promise<void> {
    if (entity.status === MediaRequestStatus.APPROVED) {
      try {
        const settings = getSettings();
        if (settings.mediary.length === 0) {
          return;
        }

        const medSettings = settings.mediary.find((m) => m.isDefault);

        if (!medSettings) {
          return;
        }

        const tmdb = new TheMovieDb();
        const mediary = new MediaryAPI({
          url: MediaryAPI.buildUrl(medSettings),
          apiKey: medSettings.apiKey,
        });

        let name: string;
        let year: number | undefined;

        if (entity.type === MediaType.MOVIE) {
          const movie = await tmdb.getMovie({ movieId: entity.media.tmdbId });
          name = movie.title;
          year = movie.release_date
            ? Number(movie.release_date.slice(0, 4))
            : undefined;

          await mediary.addSubscribe({
            tmdbid: entity.media.tmdbId,
            type: 'movie',
            name,
            year,
          });
        } else {
          const tv = await tmdb.getTvShow({ tvId: entity.media.tmdbId });
          name = tv.name;
          year = tv.first_air_date
            ? Number(tv.first_air_date.slice(0, 4))
            : undefined;

          const seasons = entity.seasons?.map((s) => s.seasonNumber) ?? [];

          for (const season of seasons) {
            try {
              await mediary.addSubscribe({
                tmdbid: entity.media.tmdbId,
                type: 'tv',
                name: name,
                year,
                seasons: String(season),
              });

              logger.info('Sent season request to Mediary', {
                label: 'Media Request',
                requestId: entity.id,
                tmdbId: entity.media.tmdbId,
                season,
              });
            } catch (e) {
              logger.warn('Failed to send season to Mediary', {
                label: 'Media Request',
                requestId: entity.id,
                tmdbId: entity.media.tmdbId,
                season,
                errorMessage: e.message,
              });
            }
          }
        }

        logger.info('Sent request to Mediary', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
          tmdbId: entity.media.tmdbId,
        });
      } catch (e) {
        logger.warn('Failed to send request to Mediary', {
          label: 'Media Request',
          requestId: entity.id,
          mediaId: entity.media.id,
          errorMessage: e.message,
        });
      }
    }
  }

  public async removeFromMediary(entity: MediaRequest): Promise<void> {
    try {
      const settings = getSettings();
      if (settings.mediary.length === 0) {
        return;
      }

      const medSettings = settings.mediary.find((m) => m.isDefault);
      if (!medSettings) {
        return;
      }

      const mediary = new MediaryAPI({
        url: MediaryAPI.buildUrl(medSettings),
        apiKey: medSettings.apiKey,
      });

      if (
        entity.type === MediaType.TV &&
        entity.seasons &&
        entity.seasons.length > 0
      ) {
        for (const season of entity.seasons) {
          try {
            await mediary.deleteSubscribe(
              entity.media.tmdbId,
              season.seasonNumber
            );
            logger.info('Removed season subscription from Mediary', {
              label: 'Media Request',
              requestId: entity.id,
              mediaId: entity.media.id,
              tmdbId: entity.media.tmdbId,
              season: season.seasonNumber,
            });
          } catch (e) {
            logger.warn('Failed to remove season subscription from Mediary', {
              label: 'Media Request',
              requestId: entity.id,
              tmdbId: entity.media.tmdbId,
              season: season.seasonNumber,
              errorMessage: e.message,
            });
          }
        }
      } else {
        try {
          await mediary.deleteSubscribe(entity.media.tmdbId);
          logger.info('Removed subscription from Mediary', {
            label: 'Media Request',
            requestId: entity.id,
            mediaId: entity.media.id,
            tmdbId: entity.media.tmdbId,
          });
        } catch (e) {
          logger.warn('Failed to remove subscription from Mediary', {
            label: 'Media Request',
            requestId: entity.id,
            tmdbId: entity.media.tmdbId,
            errorMessage: e.message,
          });
        }
      }
    } catch (e) {
      logger.error('Unexpected error in removeFromMediary', {
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

    const statusKey = entity.is4k ? 'status4k' : 'status';
    const seasonRequestRepository = getRepository(SeasonRequest);
    const requestRepository = getRepository(MediaRequest);

    if (
      entity.status === MediaRequestStatus.APPROVED &&
      // Do not update the status if the item is already partially available or available
      media[statusKey] !== MediaStatus.AVAILABLE &&
      media[statusKey] !== MediaStatus.PARTIALLY_AVAILABLE &&
      media[statusKey] !== MediaStatus.PROCESSING
    ) {
      media[statusKey] = MediaStatus.PROCESSING;
      await mediaRepository.save(media);
    }

    if (
      media.mediaType === MediaType.MOVIE &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] !== MediaStatus.DELETED
    ) {
      media[statusKey] = MediaStatus.UNKNOWN;
      await mediaRepository.save(media);
    }

    /**
     * If the media type is TV, and we are declining a request,
     * we must check if its the only pending request and that
     * there the current media status is just pending (meaning no
     * other requests have yet to be approved)
     */
    if (
      media.mediaType === MediaType.TV &&
      entity.status === MediaRequestStatus.DECLINED &&
      media[statusKey] === MediaStatus.PENDING
    ) {
      const pendingCount = await requestRepository.count({
        where: {
          media: { id: media.id },
          status: MediaRequestStatus.PENDING,
          is4k: entity.is4k,
          id: Not(entity.id),
        },
      });

      if (pendingCount === 0) {
        // Re-fetch media without requests to avoid cascade issues
        const freshMedia = await mediaRepository.findOne({
          where: { id: media.id },
        });
        if (freshMedia) {
          freshMedia[statusKey] = MediaStatus.UNKNOWN;
          await mediaRepository.save(freshMedia);
        }
      }
    }

    // Reset season statuses when a TV request is declined
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

        if (season && season[statusKey] === MediaStatus.PENDING) {
          const otherActiveRequests = await requestRepository
            .createQueryBuilder('request')
            .leftJoinAndSelect('request.seasons', 'season')
            .where('request.mediaId = :mediaId', { mediaId: media.id })
            .andWhere('request.id != :requestId', { requestId: entity.id })
            .andWhere('request.is4k = :is4k', { is4k: entity.is4k })
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
            season[statusKey] = MediaStatus.UNKNOWN;
            await seasonRepository.save(season);
          }
        }
      }
    }

    // Approve child seasons if parent is approved
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
        !request.is4k &&
        request.status !== MediaRequestStatus.COMPLETED &&
        request.status !== MediaRequestStatus.DECLINED
    );
    const hasActive4k = fullMedia.requests.some(
      (request) =>
        request.is4k &&
        request.status !== MediaRequestStatus.COMPLETED &&
        request.status !== MediaRequestStatus.DECLINED
    );

    const needsStatusUpdate =
      !hasActive &&
      fullMedia.status !== MediaStatus.AVAILABLE &&
      fullMedia.status !== MediaStatus.PARTIALLY_AVAILABLE;

    const needs4kStatusUpdate =
      !hasActive4k &&
      fullMedia.status4k !== MediaStatus.AVAILABLE &&
      fullMedia.status4k !== MediaStatus.PARTIALLY_AVAILABLE;

    if (needsStatusUpdate || needs4kStatusUpdate) {
      // Re-fetch WITHOUT requests to avoid cascade issues on save
      const cleanMedia = await manager.findOneOrFail(Media, {
        where: { id: entity.media.id },
      });

      if (needsStatusUpdate) {
        const hadCompleted = fullMedia.requests.some(
          (r) => !r.is4k && r.status === MediaRequestStatus.COMPLETED
        );
        cleanMedia.status = hadCompleted
          ? MediaStatus.DELETED
          : MediaStatus.UNKNOWN;
      }

      if (needs4kStatusUpdate) {
        const hadCompleted4k = fullMedia.requests.some(
          (r) => r.is4k && r.status === MediaRequestStatus.COMPLETED
        );
        cleanMedia.status4k = hadCompleted4k
          ? MediaStatus.DELETED
          : MediaStatus.UNKNOWN;
      }

      await manager.save(cleanMedia);
    }
  }

  public async afterUpdate(event: UpdateEvent<MediaRequest>): Promise<void> {
    if (!event.entity) {
      return;
    }

    try {
      await this.sendToMediary(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to Mediary in afterUpdate subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
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
      await this.sendToMediary(event.entity as MediaRequest);
    } catch (e) {
      logger.error('Error while sending to Mediary in afterInsert subscriber', {
        label: 'Media Request',
        requestId: (event.entity as MediaRequest).id,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
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

    await this.removeFromMediary(event.entity as MediaRequest);
  }

  public listenTo(): typeof MediaRequest {
    return MediaRequest;
  }
}
