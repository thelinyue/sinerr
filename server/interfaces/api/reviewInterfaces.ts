import type MediaReview from '@server/entity/MediaReview';

/**
 * 媒体短评相关接口类型
 */
export interface MediaReviewRequestBody {
  /** 评分 1-5 */
  rating: number;
  /** 短评内容 */
  message: string;
  /** 评论目标季号（仅剧集）：null 且 episodeNumber 为 null 表示整部剧集 */
  seasonNumber?: number | null;
  /** 评论目标集号（仅剧集，必须有 seasonNumber） */
  episodeNumber?: number | null;
}

export interface MediaReviewsResponse {
  /** 平均评分（0-5），无短评时为 0 */
  averageRating: number;
  /** 短评总数 */
  reviewCount: number;
  results: MediaReview[];
}
