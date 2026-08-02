import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import {
  BlocklistedMediaError,
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type {
  MediaRequestBody,
  RequestResultsResponse,
} from '@server/interfaces/api/requestInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { EntityNotFoundError } from 'typeorm';

const requestRoutes = Router();

requestRoutes.get<Record<string, unknown>, RequestResultsResponse>(
  '/',
  async (req, res, next) => {
    try {
      const pageSize = req.query.take ? Number(req.query.take) : 10;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const requestedBy = req.query.requestedBy
        ? Number(req.query.requestedBy)
        : null;
      const mediaType = (req.query.mediaType as MediaType | 'all') || 'all';

      let statusFilter: MediaRequestStatus[];

      switch (req.query.filter) {
        case 'approved':
        case 'processing':
          statusFilter = [MediaRequestStatus.APPROVED];
          break;
        case 'pending':
          statusFilter = [MediaRequestStatus.PENDING];
          break;
        case 'unavailable':
          statusFilter = [
            MediaRequestStatus.PENDING,
            MediaRequestStatus.APPROVED,
          ];
          break;
        case 'failed':
          statusFilter = [MediaRequestStatus.FAILED];
          break;
        case 'completed':
        case 'available':
        case 'deleted':
          statusFilter = [MediaRequestStatus.COMPLETED];
          break;
        default:
          statusFilter = [
            MediaRequestStatus.PENDING,
            MediaRequestStatus.APPROVED,
            MediaRequestStatus.DECLINED,
            MediaRequestStatus.FAILED,
            MediaRequestStatus.COMPLETED,
          ];
      }

      let mediaStatusFilter: MediaStatus[];

      switch (req.query.filter) {
        case 'available':
          mediaStatusFilter = [MediaStatus.AVAILABLE];
          break;
        case 'processing':
        case 'unavailable':
          mediaStatusFilter = [
            MediaStatus.UNKNOWN,
            MediaStatus.PENDING,
            MediaStatus.PROCESSING,
            MediaStatus.PARTIALLY_AVAILABLE,
          ];
          break;
        case 'deleted':
          mediaStatusFilter = [MediaStatus.DELETED];
          break;
        default:
          mediaStatusFilter = [
            MediaStatus.UNKNOWN,
            MediaStatus.PENDING,
            MediaStatus.PROCESSING,
            MediaStatus.PARTIALLY_AVAILABLE,
            MediaStatus.AVAILABLE,
            MediaStatus.DELETED,
          ];
      }

      let sortFilter: string;
      let sortDirection: 'ASC' | 'DESC';

      switch (req.query.sort) {
        case 'modified':
          sortFilter = 'request.updatedAt';
          break;
        default:
          sortFilter = 'request.id';
      }

      switch (req.query.sortDirection) {
        case 'asc':
          sortDirection = 'ASC';
          break;
        default:
          sortDirection = 'DESC';
      }

      let query = getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.seasons', 'seasons')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .where('request.status IN (:...requestStatus)', {
          requestStatus: statusFilter,
        })
        .andWhere('media.status IN (:...mediaStatus)', {
          mediaStatus: mediaStatusFilter,
        });

      if (
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        if (requestedBy && requestedBy !== req.user?.id) {
          return next({
            status: 403,
            message: "You do not have permission to view this user's requests.",
          });
        }

        query = query.andWhere('requestedBy.id = :id', {
          id: req.user?.id,
        });
      } else if (requestedBy) {
        query = query.andWhere('requestedBy.id = :id', {
          id: requestedBy,
        });
      }

      switch (mediaType) {
        case 'all':
          break;
        case 'movie':
          query = query.andWhere('request.type = :type', {
            type: MediaType.MOVIE,
          });
          break;
        case 'tv':
          query = query.andWhere('request.type = :type', {
            type: MediaType.TV,
          });
          break;
      }

      const [requests, requestCount] = await query
        .orderBy(sortFilter, sortDirection)
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: requests,
        serviceErrors: {},
      });
    } catch (e) {
      logger.error('Something went wrong retrieving requests.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

requestRoutes.post<never, MediaRequest, MediaRequestBody>(
  '/',
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to request media.',
        });
      }
      const request = await MediaRequest.request(req.body, req.user);

      return res.status(201).json(request);
    } catch (error) {
      if (!(error instanceof Error)) {
        return next({ status: 500, message: 'Unknown error occurred.' });
      }

      switch (error.constructor) {
        case RequestPermissionError:
        case QuotaRestrictedError:
          return next({ status: 403, message: error.message });
        case DuplicateMediaRequestError:
          return next({ status: 409, message: error.message });
        case NoSeasonsAvailableError:
          return next({ status: 202, message: error.message });
        case BlocklistedMediaError:
          return next({ status: 403, message: error.message });
        default:
          return next({ status: 500, message: error.message });
      }
    }
  }
);

requestRoutes.get('/count', async (_req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const result = await requestRepository
      .createQueryBuilder('request')
      .innerJoin('request.media', 'media')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN request.type = :movieType THEN 1 ELSE 0 END)`,
        'movie'
      )
      .addSelect(
        `SUM(CASE WHEN request.type = :tvType THEN 1 ELSE 0 END)`,
        'tv'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :pending THEN 1 ELSE 0 END)`,
        'pending'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :approved THEN 1 ELSE 0 END)`,
        'approved'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :declined THEN 1 ELSE 0 END)`,
        'declined'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :approved AND media.status != :availableStatus THEN 1 ELSE 0 END)`,
        'processing'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :approved AND media.status = :availableStatus THEN 1 ELSE 0 END)`,
        'available'
      )
      .addSelect(
        `SUM(CASE WHEN request.status = :completed THEN 1 ELSE 0 END)`,
        'completed'
      )
      .setParameters({
        movieType: MediaType.MOVIE,
        tvType: MediaType.TV,
        pending: MediaRequestStatus.PENDING,
        approved: MediaRequestStatus.APPROVED,
        declined: MediaRequestStatus.DECLINED,
        completed: MediaRequestStatus.COMPLETED,
        availableStatus: MediaStatus.AVAILABLE,
      })
      .getRawOne<{
        total: string;
        movie: string;
        tv: string;
        pending: string;
        approved: string;
        declined: string;
        processing: string;
        available: string;
        completed: string;
      }>();

    return res.status(200).json({
      total: Number(result?.total ?? 0),
      movie: Number(result?.movie ?? 0),
      tv: Number(result?.tv ?? 0),
      pending: Number(result?.pending ?? 0),
      approved: Number(result?.approved ?? 0),
      declined: Number(result?.declined ?? 0),
      processing: Number(result?.processing ?? 0),
      available: Number(result?.available ?? 0),
      completed: Number(result?.completed ?? 0),
    });
  } catch (e) {
    logger.error('Something went wrong retrieving request counts', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Unable to retrieve request counts.' });
  }
});

requestRoutes.get('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const request = await requestRepository.findOneOrFail({
      where: { id: Number(req.params.requestId) },
      relations: { requestedBy: true, modifiedBy: true },
    });

    if (
      request.requestedBy.id !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      )
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to view this request.',
      });
    }

    // 填充点赞聚合信息（数量 + 当前用户是否已点赞），供前端 RequestCard 展示
    const requestVoteRepository = getRepository(RequestVote);
    request.voteCount = await requestVoteRepository.count({
      where: { request: { id: request.id } },
    });
    request.userVoted =
      req.user?.id != null &&
      (await requestVoteRepository.count({
        where: { request: { id: request.id }, user: { id: req.user.id } },
      })) > 0;

    return res.status(200).json(request);
  } catch (e) {
    if (e instanceof EntityNotFoundError) {
      return next({ status: 404, message: 'Request not found.' });
    }
    logger.error('Failed to retrieve request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Something went wrong.' });
  }
});

requestRoutes.put<{ requestId: string }>(
  '/:requestId',
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);
    const userRepository = getRepository(User);
    try {
      const request = await requestRepository.findOne({
        where: {
          id: Number(req.params.requestId),
        },
      });

      if (!request) {
        return next({ status: 404, message: 'Request not found.' });
      }

      if (
        (request.requestedBy.id !== req.user?.id ||
          (req.body.mediaType !== 'tv' &&
            !req.user?.hasPermission(Permission.REQUEST_ADVANCED))) &&
        !req.user?.hasPermission(Permission.MANAGE_REQUESTS)
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this request.',
        });
      }

      let requestUser = request.requestedBy;

      if (
        req.body.userId &&
        req.body.userId !== request.requestedBy.id &&
        !req.user?.hasPermission([
          Permission.MANAGE_USERS,
          Permission.MANAGE_REQUESTS,
        ])
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to modify the request user.',
        });
      } else if (req.body.userId) {
        requestUser = await userRepository.findOneOrFail({
          where: { id: req.body.userId },
        });
      }

      if (req.body.mediaType === MediaType.MOVIE) {
        request.serverId = req.body.serverId;
        request.profileId = req.body.profileId;
        request.rootFolder = req.body.rootFolder;
        request.tags = req.body.tags;
        request.requestedBy = requestUser as User;

        await requestRepository.save(request);
      } else if (req.body.mediaType === MediaType.TV) {
        const mediaRepository = getRepository(Media);
        request.serverId = req.body.serverId;
        request.profileId = req.body.profileId;
        request.rootFolder = req.body.rootFolder;
        request.languageProfileId = req.body.languageProfileId;
        request.tags = req.body.tags;
        request.requestedBy = requestUser as User;

        const requestedSeasons = req.body.seasons as number[] | undefined;

        if (!requestedSeasons || requestedSeasons.length === 0) {
          throw new Error(
            'Missing seasons. If you want to cancel a series request, use the DELETE method.'
          );
        }

        // Get existing media so we can work with all the requests
        const media = await mediaRepository.findOneOrFail({
          where: { tmdbId: request.media.tmdbId, mediaType: MediaType.TV },
          relations: { requests: true },
        });

        // Get all requested seasons that are not part of this request we are editing
        const existingSeasons = media.requests
          .filter(
            (r) =>
              r.id !== request.id &&
              r.status !== MediaRequestStatus.DECLINED &&
              r.status !== MediaRequestStatus.COMPLETED
          )
          .reduce((seasons, r) => {
            const combinedSeasons = r.seasons.map(
              (season) => season.seasonNumber
            );

            return [...seasons, ...combinedSeasons];
          }, [] as number[]);

        const filteredSeasons = requestedSeasons.filter(
          (rs) => !existingSeasons.includes(rs)
        );

        if (filteredSeasons.length === 0) {
          return next({
            status: 202,
            message: 'No seasons available to request',
          });
        }

        const newSeasons = requestedSeasons.filter(
          (sn) => !request.seasons.map((s) => s.seasonNumber).includes(sn)
        );

        request.seasons = request.seasons.filter((rs) =>
          filteredSeasons.includes(rs.seasonNumber)
        );

        if (newSeasons.length > 0) {
          logger.debug('Adding new seasons to request', {
            label: 'Media Request',
            newSeasons,
          });
          request.seasons.push(
            ...newSeasons.map(
              (ns) =>
                new SeasonRequest({
                  seasonNumber: ns,
                  status: MediaRequestStatus.PENDING,
                })
            )
          );
        }

        await requestRepository.save(request);
      }

      return res.status(200).json(request);
    } catch (e) {
      logger.error('Something went wrong editing a request.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

requestRoutes.delete('/:requestId', async (req, res, next) => {
  const requestRepository = getRepository(MediaRequest);

  try {
    const request = await requestRepository.findOneOrFail({
      where: { id: Number(req.params.requestId) },
      relations: { requestedBy: true, modifiedBy: true },
    });

    if (
      !req.user?.hasPermission(Permission.MANAGE_REQUESTS) &&
      (request.requestedBy.id !== req.user?.id ||
        request.status !== MediaRequestStatus.PENDING)
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to delete this request.',
      });
    }

    await requestRepository.remove(request);

    return res.status(204).send();
  } catch (e) {
    if (e instanceof EntityNotFoundError) {
      return next({ status: 404, message: 'Request not found.' });
    }
    logger.error('Something went wrong deleting a request.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Something went wrong.' });
  }
});

requestRoutes.post<{
  requestId: string;
}>(
  '/:requestId/retry',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      // this also triggers updating the parent media's status & sending to *arr
      request.status = MediaRequestStatus.APPROVED;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(request);
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Request not found.' });
      }
      logger.error('Error processing request retry', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

requestRoutes.post<{
  requestId: string;
  status: 'pending' | 'approve' | 'decline';
}>(
  '/:requestId/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const requestRepository = getRepository(MediaRequest);

    try {
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      let newStatus: MediaRequestStatus;

      switch (req.params.status) {
        case 'pending':
          newStatus = MediaRequestStatus.PENDING;
          break;
        case 'approve':
          newStatus = MediaRequestStatus.APPROVED;
          break;
        case 'decline':
          newStatus = MediaRequestStatus.DECLINED;
          break;
        default:
          return next({ status: 400, message: 'Invalid request status.' });
      }

      request.status = newStatus;
      request.modifiedBy = req.user;
      await requestRepository.save(request);

      return res.status(200).json(request);
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Request not found.' });
      }
      logger.error('Error processing request update', {
        label: 'Media Request',
        message: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

export default requestRoutes;
