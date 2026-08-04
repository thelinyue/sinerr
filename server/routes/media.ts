import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import Season from '@server/entity/Season';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import type { FindOneOptions } from 'typeorm';
import { EntityNotFoundError, In, IsNull, Not } from 'typeorm';

const mediaRoutes = Router();

mediaRoutes.get('/', async (req, res, next) => {
  const mediaRepository = getRepository(Media);

  const pageSize = req.query.take ? Number(req.query.take) : 20;
  const skip = req.query.skip ? Number(req.query.skip) : 0;

  let statusFilter = undefined;

  switch (req.query.filter) {
    case 'available':
      statusFilter = MediaStatus.AVAILABLE;
      break;
    case 'partial':
      statusFilter = MediaStatus.PARTIALLY_AVAILABLE;
      break;
    case 'allavailable':
      statusFilter = In([
        MediaStatus.AVAILABLE,
        MediaStatus.PARTIALLY_AVAILABLE,
      ]);
      break;
    case 'processing':
      statusFilter = MediaStatus.PROCESSING;
      break;
    case 'pending':
      statusFilter = MediaStatus.PENDING;
      break;
  }

  let sortFilter: FindOneOptions<Media>['order'] = {
    id: 'DESC',
  };

  switch (req.query.sort) {
    case 'modified':
      sortFilter = {
        updatedAt: 'DESC',
      };
      break;
    case 'mediaAdded':
      sortFilter = {
        mediaAddedAt: 'DESC',
      };
  }

  let whereClause: FindOneOptions<Media>['where'];
  if (statusFilter || req.query.sort === 'mediaAdded') {
    whereClause = {};
    if (statusFilter) whereClause.status = statusFilter;
    if (req.query.sort === 'mediaAdded')
      whereClause.mediaAddedAt = Not(IsNull());
  }

  try {
    const [media, mediaCount] = await mediaRepository.findAndCount({
      order: sortFilter,
      where: whereClause,
      take: pageSize,
      skip,
    });
    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(mediaCount / pageSize),
        pageSize,
        results: mediaCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: media,
    } as MediaResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

mediaRoutes.post<
  {
    id: string;
    status: 'available' | 'partial' | 'processing' | 'pending' | 'unknown';
  },
  Media
>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);
    const seasonRepository = getRepository(Season);

    const media = await mediaRepository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    switch (req.params.status) {
      case 'available':
        media.status = MediaStatus.AVAILABLE;

        if (media.mediaType === MediaType.TV) {
          const expectedSeasons = req.body.seasons ?? [];

          for (const expectedSeason of expectedSeasons) {
            let season = media.seasons.find(
              (s) => s.seasonNumber === expectedSeason?.seasonNumber
            );

            if (!season) {
              season = seasonRepository.create({
                seasonNumber: expectedSeason?.seasonNumber,
              });
              media.seasons.push(season);
            }

            season.status = MediaStatus.AVAILABLE;
          }
        }
        break;
      case 'partial':
        if (media.mediaType === MediaType.MOVIE) {
          return next({
            status: 400,
            message: 'Only series can be set to be partially available',
          });
        }
        media.status = MediaStatus.PARTIALLY_AVAILABLE;
        break;
      case 'processing':
        media.status = MediaStatus.PROCESSING;
        break;
      case 'pending':
        media.status = MediaStatus.PENDING;
        break;
      case 'unknown':
        media.status = MediaStatus.UNKNOWN;
    }

    await mediaRepository.save(media);

    return res.status(200).json(media);
  }
);

mediaRoutes.delete(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);

      const media = await mediaRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      if (media.status === MediaStatus.BLOCKLISTED) {
        media.resetServiceData();
        await mediaRepository.save(media);
      } else {
        await mediaRepository.remove(media);
      }

      return res.status(204).send();
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return res.status(204).send();
      }
      logger.error('Something went wrong deleting media', {
        label: 'Media',
        mediaId: req.params.id,
        message: e.message,
      });
      next({ status: 500, message: 'Failed to delete media' });
    }
  }
);

/**
 * 媒体级声援（Sinerr 2.0 模块 5）
 *
 * 声援语义从「请求级」提升为「媒体级」：服务端定位该媒体「当前请求」
 * （优先 PENDING 最早，其次最早创建的非拒绝请求），在其上点赞。
 * 聚合计数按用户去重（同一用户给同一媒体的多条请求点赞只计一次）。
 */
async function getMediaVoteState(
  media: Media,
  userId?: number
): Promise<{
  voteCount: number;
  userVoted: boolean;
  activeRequestId: number | null;
}> {
  const requestRepo = getRepository(MediaRequest);
  const voteRepo = getRepository(RequestVote);

  const requests = await requestRepo.find({
    where: { media: { id: media.id } },
    relations: { requestedBy: true },
  });

  const activeRequest =
    requests
      .filter((r) => r.status !== MediaRequestStatus.DECLINED)
      .sort(
        (a, b) =>
          (a.status === MediaRequestStatus.PENDING ? 0 : 1) -
            (b.status === MediaRequestStatus.PENDING ? 0 : 1) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      )[0] ?? null;

  const requestIds = requests.map((r) => r.id);

  // 去重计数：该媒体全部请求上的不同点赞用户
  let voteCount = 0;
  if (requestIds.length > 0) {
    const rows = await voteRepo
      .createQueryBuilder('vote')
      .select('DISTINCT vote.userId', 'userId')
      .where('vote.requestId IN (:...requestIds)', { requestIds })
      .getRawMany();
    voteCount = rows.length;
  }

  const userVoted =
    !!userId &&
    requestIds.length > 0 &&
    (await voteRepo.count({
      where: { user: { id: userId }, request: { id: In(requestIds) } },
    })) > 0;

  return { voteCount, userVoted, activeRequestId: activeRequest?.id ?? null };
}

mediaRoutes.get<{ tmdbId: string; mediaType: string }>(
  '/:tmdbId/:mediaType/vote',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const media = await getRepository(Media).findOne({
        where: {
          tmdbId: Number(req.params.tmdbId),
          mediaType: req.params.mediaType as MediaType,
        },
      });
      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }
      return res.status(200).json(await getMediaVoteState(media, req.user?.id));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

mediaRoutes.post<{ tmdbId: string; mediaType: string }>(
  '/:tmdbId/:mediaType/vote',
  isAuthenticated(Permission.VOTE),
  async (req, res, next) => {
    try {
      const media = await getRepository(Media).findOne({
        where: {
          tmdbId: Number(req.params.tmdbId),
          mediaType: req.params.mediaType as MediaType,
        },
      });
      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }

      const requestRepo = getRepository(MediaRequest);
      const requests = await requestRepo.find({
        where: { media: { id: media.id } },
        relations: { requestedBy: true },
      });
      const activeRequest = requests
        .filter((r) => r.status !== MediaRequestStatus.DECLINED)
        .sort(
          (a, b) =>
            (a.status === MediaRequestStatus.PENDING ? 0 : 1) -
              (b.status === MediaRequestStatus.PENDING ? 0 : 1) ||
            a.createdAt.getTime() - b.createdAt.getTime()
        )[0];

      if (!activeRequest) {
        return next({
          status: 404,
          message: 'No active request found for this media.',
        });
      }
      if (activeRequest.requestedBy.id === req.user?.id) {
        return next({
          status: 400,
          message: 'You cannot vote on your own request.',
        });
      }

      const existing = await getRepository(RequestVote).findOne({
        where: {
          request: { id: activeRequest.id },
          user: { id: req.user?.id },
        },
      });
      if (!existing) {
        await getRepository(RequestVote).save(
          new RequestVote({ request: activeRequest, user: req.user! })
        );
      }

      return res.status(200).json(await getMediaVoteState(media, req.user?.id));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

mediaRoutes.delete<{ tmdbId: string; mediaType: string }>(
  '/:tmdbId/:mediaType/vote',
  isAuthenticated(Permission.VOTE),
  async (req, res, next) => {
    try {
      const media = await getRepository(Media).findOne({
        where: {
          tmdbId: Number(req.params.tmdbId),
          mediaType: req.params.mediaType as MediaType,
        },
      });
      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }

      const requestRepo = getRepository(MediaRequest);
      const requests = await requestRepo.find({
        where: { media: { id: media.id } },
      });
      const requestIds = requests.map((r) => r.id);
      if (requestIds.length > 0 && req.user) {
        await getRepository(RequestVote)
          .createQueryBuilder()
          .delete()
          .where('userId = :userId AND requestId IN (:...requestIds)', {
            userId: req.user.id,
            requestIds,
          })
          .execute();
      }

      return res.status(200).json(await getMediaVoteState(media, req.user?.id));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default mediaRoutes;
