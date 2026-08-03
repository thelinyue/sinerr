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

/**
 * 评论人观看进度（来自本地 PlaybackEvent）
 *
 * - completed：该媒体已看完
 * - watching：剧集最新看到 seasonNumber/episodeNumber
 * - unwatched：有播放记录但未看完（电影未看完也归此类）
 * - null：无播放记录或该用户关闭播放可见性
 */
export type ReviewProgress =
  | { status: 'completed' }
  | {
      status: 'watching';
      seasonNumber: number;
      episodeNumber: number;
    }
  | { status: 'unwatched' };

/** 附带展示字段的短评 */
export interface MediaReviewItem extends MediaReview {
  /** 是否被编辑过（updatedAt > createdAt） */
  edited: boolean;
  /** 评论人观看进度；null 表示无播放记录或不可见 */
  progress: ReviewProgress | null;
}

export interface MediaReviewsResponse {
  /** 平均评分（0-5），无短评时为 0 */
  averageRating: number;
  /** 短评总数 */
  reviewCount: number;
  results: MediaReviewItem[];
}
