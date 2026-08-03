import type { MediaType } from '@server/constants/media';

/**
 * 动态信息流类型：请求 / 声援 / Issue 报告 / 播放记录 / 媒体短评
 */
export type ActivityType = 'request' | 'vote' | 'issue' | 'playback' | 'review';

/**
 * 动态信息流条目
 *
 * 服务端只返回媒体标识（tmdbId/mediaType），标题与海报由前端
 * 复用现有 SWR 懒加载，避免为信息流单独维护冗余数据。
 */
export interface ActivityItem {
  id: number;
  type: ActivityType;
  createdAt: Date;
  actor: {
    id: number;
    displayName: string;
    avatar: string;
  };
  payload: {
    tmdbId?: number;
    mediaType?: MediaType;
    requestId?: number;
    issueId?: number;
    /** 播放记录：是否看完 */
    completed?: boolean;
    /** 播放记录：本次观看时长（秒） */
    durationSeconds?: number;
    /** 播放记录：季号 */
    seasonNumber?: number | null;
    /** 播放记录：集号 */
    episodeNumber?: number | null;
    /** 短评：评分 1-5 */
    rating?: number;
    /** 短评：一句话内容 */
    message?: string;
  };
}

export interface ActivityResponse {
  results: ActivityItem[];
}
