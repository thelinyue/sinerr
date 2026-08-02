import type MediaReview from '@server/entity/MediaReview';

/**
 * 媒体短评相关接口类型
 */
export interface MediaReviewRequestBody {
  /** 评分 1-5 */
  rating: number;
  /** 短评内容 */
  message: string;
}

export interface MediaReviewsResponse {
  /** 平均评分（0-5），无短评时为 0 */
  averageRating: number;
  /** 短评总数 */
  reviewCount: number;
  results: MediaReview[];
}
