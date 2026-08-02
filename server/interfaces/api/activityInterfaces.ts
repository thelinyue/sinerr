import type { MediaType } from '@server/constants/media';

/**
 * 动态信息流类型：请求 / 声援 / Issue 报告
 */
export type ActivityType = 'request' | 'vote' | 'issue';

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
  };
}

export interface ActivityResponse {
  results: ActivityItem[];
}
