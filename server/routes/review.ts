import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import { User } from '@server/entity/User';
import type {
  MediaReviewRequestBody,
  MediaReviewsResponse,
} from '@server/interfaces/api/reviewInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { EntityNotFoundError, IsNull } from 'typeorm';

const reviewRoutes = Router();

/**
 * 按 tmdbId + mediaType 定位 Media 实体
 */
async function findMedia(
  tmdbId: number,
  mediaType: MediaType
): Promise<Media | null> {
  return getRepository(Media).findOne({ where: { tmdbId, mediaType } });
}

/**
 * 解析并校验评论目标（季/集）
 *
 * 规则：
 * - 电影不允许携带季/集目标
 * - episodeNumber 有值但 seasonNumber 为空 → 非法
 * - 返回 { seasonNumber, episodeNumber }，两者都可能为 null/undefined
 */
function parseTarget(
  mediaType: MediaType,
  seasonNumberRaw: unknown,
  episodeNumberRaw: unknown
): { seasonNumber?: number | null; episodeNumber?: number | null } | string {
  const seasonNumber =
    seasonNumberRaw === undefined ||
    seasonNumberRaw === null ||
    seasonNumberRaw === ''
      ? null
      : Number(seasonNumberRaw);
  const episodeNumber =
    episodeNumberRaw === undefined ||
    episodeNumberRaw === null ||
    episodeNumberRaw === ''
      ? null
      : Number(episodeNumberRaw);

  if (mediaType === MediaType.MOVIE) {
    if (seasonNumber !== null || episodeNumber !== null) {
      return 'Movie reviews cannot target a season or episode.';
    }
    return { seasonNumber: null, episodeNumber: null };
  }

  if (
    seasonNumber !== null &&
    (!Number.isInteger(seasonNumber) || seasonNumber < 1)
  ) {
    return 'Season number must be a positive integer.';
  }

  if (episodeNumber !== null) {
    if (seasonNumber === null) {
      return 'Episode number requires a season number.';
    }
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) {
      return 'Episode number must be a positive integer.';
    }
  }

  return { seasonNumber, episodeNumber };
}

/**
 * 为一批短评附带「评论人观看进度」与「已编辑」标记
 *
 * 进度数据源为本地 PlaybackEvent（webhook 写入，按 user+tmdbId 保存最新播放），
 * 一次 IN 查询拿到全部评论人的播放记录，避免对 Jellyfin 逐用户请求。
 *
 * 可见性（隐私）：与动态播放记录一致，跟随 playbackVisible（默认公开）。
 * 当前用户为管理员（MANAGE_USERS）时始终可见；普通用户看不到
 * 已关闭 playbackVisible 的评论人进度。
 *
 * 返回带 extra 字段（edited/progress）的评论数组。
 */
async function attachReviewProgress(
  reviews: MediaReview[],
  viewer: User | undefined,
  tmdbId: number,
  mediaType: MediaType
): Promise<MediaReviewsResponse['results']> {
  if (reviews.length === 0) {
    return [];
  }

  // 管理员可见所有进度；非管理员需排除关闭可见性的用户
  const isAdmin = viewer?.hasPermission(Permission.MANAGE_USERS);
  let hiddenUserIds: number[] = [];
  if (!isAdmin) {
    hiddenUserIds = (
      await getRepository(User).find({
        where: { settings: { playbackVisible: false } },
        select: ['id'],
      })
    ).map((u) => u.id);
  }

  // 批量拉取这批评论人的最新播放记录（按 tmdbId + mediaType 过滤）
  const userIds = [...new Set(reviews.map((r) => r.user.id))];
  const events = await getRepository(PlaybackEvent)
    .createQueryBuilder('event')
    .leftJoinAndSelect('event.user', 'user')
    .where('event.tmdbId = :tmdbId', { tmdbId })
    .andWhere('event.mediaType = :mediaType', { mediaType })
    .andWhere('user.id IN (:...userIds)', { userIds })
    .getMany();

  const eventByUser = new Map<number, PlaybackEvent>();
  for (const event of events) {
    eventByUser.set(event.user.id, event);
  }

  return reviews.map((review) => {
    const event = eventByUser.get(review.user.id);
    const progressVisible = isAdmin || !hiddenUserIds.includes(review.user.id);

    // 进度只表达「最新看到哪集」：
    // - 电影：已看完 / 未看（PlaybackEvent 无季集概念）
    // - 剧集：已看完 / 最新看到 SxEy / 未看
    // 无播放记录时归为「未看」（unwatched）；仅隐私不可见时返回 null（前端不显示）
    let progress: MediaReviewsResponse['results'][number]['progress'] = null;
    if (progressVisible) {
      if (mediaType === MediaType.TV) {
        if (event?.completed) {
          progress = { status: 'completed' };
        } else if (
          event &&
          event.seasonNumber !== null &&
          event.seasonNumber !== undefined &&
          event.episodeNumber !== null &&
          event.episodeNumber !== undefined
        ) {
          progress = {
            status: 'watching',
            seasonNumber: event.seasonNumber,
            episodeNumber: event.episodeNumber,
          };
        } else {
          progress = { status: 'unwatched' };
        }
      } else {
        progress = {
          status: event?.completed ? 'completed' : 'unwatched',
        };
      }
    }

    return {
      ...review,
      edited:
        new Date(review.updatedAt).getTime() >
        new Date(review.createdAt).getTime(),
      progress,
    };
  });
}

reviewRoutes.get<{ tmdbId: string; mediaType: string }, MediaReviewsResponse>(
  '/:tmdbId/:mediaType',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.params.mediaType as MediaType;

    if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
      return next({ status: 400, message: 'Invalid media type.' });
    }

    const target = parseTarget(
      mediaType,
      req.query.seasonNumber,
      req.query.episodeNumber
    );
    if (typeof target === 'string') {
      return next({ status: 400, message: target });
    }

    try {
      const media = await findMedia(tmdbId, mediaType);

      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }

      const reviewRepository = getRepository(MediaReview);
      const query = reviewRepository
        .createQueryBuilder('review')
        .leftJoinAndSelect('review.user', 'user')
        .where('review.mediaId = :mediaId', { mediaId: media.id });

      // 目标过滤：完全匹配（季/集）
      // 注意：null 目标必须用 IS NULL，不能用 IS :param（postgres 下参数绑定到 IS 会语法错误）
      query.andWhere(
        target.seasonNumber === null
          ? 'review.seasonNumber IS NULL'
          : 'review.seasonNumber = :seasonNumber',
        target.seasonNumber === null
          ? {}
          : { seasonNumber: target.seasonNumber }
      );
      query.andWhere(
        target.episodeNumber === null
          ? 'review.episodeNumber IS NULL'
          : 'review.episodeNumber = :episodeNumber',
        target.episodeNumber === null
          ? {}
          : { episodeNumber: target.episodeNumber }
      );

      const reviews = await query.orderBy('review.createdAt', 'DESC').getMany();

      const averageRating = reviews.length
        ? Math.round(
            (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) *
              10
          ) / 10
        : 0;

      const results = await attachReviewProgress(
        reviews,
        req.user,
        media.tmdbId,
        mediaType
      );

      return res.status(200).json({
        averageRating,
        reviewCount: reviews.length,
        results,
      });
    } catch (e) {
      logger.error('Something went wrong retrieving media reviews.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

reviewRoutes.post<
  { tmdbId: string; mediaType: string },
  MediaReview,
  MediaReviewRequestBody
>(
  '/:tmdbId/:mediaType',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.params.mediaType as MediaType;

    if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
      return next({ status: 400, message: 'Invalid media type.' });
    }

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return next({
        status: 400,
        message: 'Rating must be an integer between 1 and 5.',
      });
    }

    const message = req.body.message?.trim();
    if (!message || message.length > 500) {
      return next({
        status: 400,
        message:
          'Review message is required and must be at most 500 characters.',
      });
    }

    const target = parseTarget(
      mediaType,
      req.body.seasonNumber,
      req.body.episodeNumber
    );
    if (typeof target === 'string') {
      return next({ status: 400, message: target });
    }

    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to submit a review.',
        });
      }

      const media = await findMedia(tmdbId, mediaType);

      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }

      const reviewRepository = getRepository(MediaReview);

      // 每个用户对同一媒体 + 同一目标（季/集）仅保留一条短评，重复提交视为更新
      const existing = await reviewRepository.findOne({
        where: {
          media: { id: media.id },
          user: { id: req.user.id },
          seasonNumber: target.seasonNumber ?? IsNull(),
          episodeNumber: target.episodeNumber ?? IsNull(),
        },
      });

      let review: MediaReview;
      if (existing) {
        // 内容无变化时不保存，避免误标「已编辑」（UpdateDateColumn 会在保存时刷新 updatedAt）
        const unchanged =
          existing.rating === rating && existing.message === message;
        if (unchanged) {
          review = existing;
        } else {
          existing.rating = rating;
          existing.message = message;
          review = await reviewRepository.save(existing);
        }
      } else {
        review = await reviewRepository.save(
          new MediaReview({
            media,
            user: req.user,
            rating,
            message,
            seasonNumber: target.seasonNumber,
            episodeNumber: target.episodeNumber,
          })
        );
      }

      return res.status(201).json(review);
    } catch (e) {
      logger.error('Something went wrong creating a media review.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

reviewRoutes.delete<{ reviewId: string }>(
  '/:reviewId',
  isAuthenticated(Permission.REQUEST),
  async (req, res, next) => {
    const reviewRepository = getRepository(MediaReview);

    try {
      const review = await reviewRepository.findOneOrFail({
        where: { id: Number(req.params.reviewId) },
        relations: { user: true },
      });

      if (
        !req.user?.hasPermission(Permission.MANAGE_REQUESTS) &&
        review.user.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to delete this review.',
        });
      }

      await reviewRepository.remove(review);
      return res.status(204).send();
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Review not found.' });
      }
      logger.error('Something went wrong deleting a media review.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

export default reviewRoutes;
