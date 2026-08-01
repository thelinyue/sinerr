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
import logger from '@server/logger';
import type { EntitySubscriberInterface, UpdateEvent } from 'typeorm';
import { EventSubscriber, In } from 'typeorm';

@EventSubscriber()
export class MediaSubscriber implements EntitySubscriberInterface<Media> {
  private async updateChildRequestStatus(event: Media) {
    const requestRepository = getRepository(MediaRequest);

    const requests = await requestRepository.find({
      where: { media: { id: event.id } },
    });

    for (const request of requests) {
      if (request.status === MediaRequestStatus.PENDING) {
        request.status = MediaRequestStatus.APPROVED;
        await requestRepository.save(request);
      }
    }
  }

  private async updateRelatedMediaRequest(event: Media, databaseEvent: Media) {
    const requestRepository = getRepository(MediaRequest);
    const seasonRequestRepository = getRepository(SeasonRequest);

    const relatedRequests = await requestRepository.find({
      relations: {
        media: true,
      },
      where: {
        media: { id: event.id },
        status: In([MediaRequestStatus.APPROVED, MediaRequestStatus.FAILED]),
      },
    });

    if (relatedRequests.length > 0) {
      const completedRequests: MediaRequest[] = [];

      for (const request of relatedRequests) {
        let shouldComplete = false;

        if (
          (event.status === MediaStatus.AVAILABLE ||
            event.status === MediaStatus.DELETED) &&
          event.mediaType === MediaType.MOVIE
        ) {
          shouldComplete = true;
        } else if (event.mediaType === 'tv') {
          const allSeasonResults = await Promise.all(
            request.seasons.map(async (requestSeason) => {
              const matchingSeason = event.seasons.find(
                (mediaSeason) =>
                  mediaSeason.seasonNumber === requestSeason.seasonNumber
              );
              const matchingOldSeason = databaseEvent.seasons.find(
                (oldSeason) =>
                  oldSeason.seasonNumber === requestSeason.seasonNumber
              );

              if (!matchingSeason) {
                return false;
              }

              const currentSeasonStatus = matchingSeason.status;
              const previousSeasonStatus = matchingOldSeason?.status;

              const hasStatusChanged =
                currentSeasonStatus !== previousSeasonStatus;

              const shouldUpdate =
                (hasStatusChanged ||
                  requestSeason.status === MediaRequestStatus.COMPLETED) &&
                (currentSeasonStatus === MediaStatus.AVAILABLE ||
                  currentSeasonStatus === MediaStatus.DELETED);

              if (shouldUpdate) {
                requestSeason.status = MediaRequestStatus.COMPLETED;
                await seasonRequestRepository.save(requestSeason);

                return true;
              }

              return false;
            })
          );

          const allSeasonsReady = allSeasonResults.every((result) => result);
          shouldComplete = allSeasonsReady;
        }

        if (shouldComplete) {
          request.status = MediaRequestStatus.COMPLETED;
          completedRequests.push(request);
        }
      }

      await requestRepository.save(completedRequests);
    }
  }

  public async beforeUpdate(event: UpdateEvent<Media>): Promise<void> {
    if (!event.entity || !event.databaseEntity) {
      return;
    }

    try {
      if (
        event.entity.status === MediaStatus.AVAILABLE &&
        event.databaseEntity?.status === MediaStatus.PENDING
      ) {
        await this.updateChildRequestStatus(event.entity as Media);
      }
    } catch (e) {
      logger.error(
        'Error while updating child request status in beforeUpdate subscriber',
        {
          label: 'Media',
          mediaId: event.entity.id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }

    const seasons = await event.manager
      .getRepository(Season)
      .createQueryBuilder('season')
      .leftJoin('season.media', 'media')
      .where('media.id = :id', { id: event.databaseEntity.id })
      .getMany();

    event.databaseEntity.seasons = seasons;
  }

  public async afterUpdate(event: UpdateEvent<Media>): Promise<void> {
    if (!event.entity || !event.databaseEntity) {
      return;
    }

    const validStatuses = [
      MediaStatus.PARTIALLY_AVAILABLE,
      MediaStatus.AVAILABLE,
      MediaStatus.DELETED,
    ];

    const seasonStatusCheck = () => {
      return event.entity?.seasons?.some((season: Season, index: number) => {
        const previousSeason = event.databaseEntity.seasons[index];

        return season.status !== previousSeason?.status;
      });
    };

    try {
      if (
        (event.entity.status !== event.databaseEntity?.status ||
          (event.entity.mediaType === MediaType.TV && seasonStatusCheck())) &&
        validStatuses.includes(event.entity.status)
      ) {
        await this.updateRelatedMediaRequest(
          event.entity as Media,
          event.databaseEntity as Media
        );
      }
    } catch (e) {
      logger.error(
        'Error while updating related requests in afterUpdate subscriber',
        {
          label: 'Media',
          mediaId: event.entity.id,
          errorMessage: e instanceof Error ? e.message : String(e),
        }
      );
    }
  }

  public listenTo(): typeof Media {
    return Media;
  }
}
