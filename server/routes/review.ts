import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaReview from '@server/entity/MediaReview';
import type {
  MediaReviewRequestBody,
  MediaReviewsResponse,
} from '@server/interfaces/api/reviewInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { EntityNotFoundError } from 'typeorm';

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

reviewRoutes.get<{ tmdbId: string; mediaType: string }, MediaReviewsResponse>(
  '/:tmdbId/:mediaType',
  isAuthenticated(),
  async (req, res, next) => {
    const tmdbId = Number(req.params.tmdbId);
    const mediaType = req.params.mediaType as MediaType;

    if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
      return next({ status: 400, message: 'Invalid media type.' });
    }

    try {
      const media = await findMedia(tmdbId, mediaType);

      if (!media) {
        return next({ status: 404, message: 'Media does not exist.' });
      }

      const reviewRepository = getRepository(MediaReview);
      const reviews = await reviewRepository
        .createQueryBuilder('review')
        .leftJoinAndSelect('review.user', 'user')
        .where('review.mediaId = :mediaId', { mediaId: media.id })
        .orderBy('review.createdAt', 'DESC')
        .getMany();

      const averageRating = reviews.length
        ? Math.round(
            (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) *
              10
          ) / 10
        : 0;

      return res.status(200).json({
        averageRating,
        reviewCount: reviews.length,
        results: reviews,
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

      // 每个用户对同一媒体仅保留一条短评，重复提交视为更新
      const existing = await reviewRepository.findOne({
        where: { media: { id: media.id }, user: { id: req.user.id } },
      });

      let review: MediaReview;
      if (existing) {
        existing.rating = rating;
        existing.message = message;
        review = await reviewRepository.save(existing);
      } else {
        review = await reviewRepository.save(
          new MediaReview({
            media,
            user: req.user,
            rating,
            message,
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
