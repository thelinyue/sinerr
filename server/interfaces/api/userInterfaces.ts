import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { PaginatedResponse } from './common';

export interface UserResultsResponse extends PaginatedResponse {
  results: User[];
}

export interface UserRequestsResponse extends PaginatedResponse {
  results: MediaRequest[];
}

export interface QuotaStatus {
  days?: number;
  limit?: number;
  used: number;
  remaining?: number;
  restricted: boolean;
}

export interface QuotaResponse {
  movie: QuotaStatus;
  tv: QuotaStatus;
}

/**
 * 用户播放时长统计（来自 PlaybackEvent.durationSeconds 聚合）
 */
export interface UserWatchTimeResponse {
  /** 今日累计播放秒数 */
  todaySeconds: number;
  /** 累计播放秒数 */
  totalSeconds: number;
}

/**
 * 用户成就徽章定义
 */
export interface Achievement {
  /** 徽章唯一标识 */
  id: string;
  /** 是否已达成 */
  earned: boolean;
  /** 当前进度（0-100） */
  progress: number;
  /** 达成所需的统计值 */
  target: number;
  /** 当前统计值 */
  current: number;
}

export interface UserAchievementsResponse {
  results: Achievement[];
}

/**
 * 用户最近观看条目（来自 PlaybackEvent 时间倒序）
 */
export interface RecentlyWatchedItem {
  /** 媒体 tmdbId */
  tmdbId: number;
  /** 媒体类型 */
  mediaType: 'movie' | 'tv';
  /** 是否看完 */
  completed: boolean;
  /** 观看时长（秒） */
  durationSeconds: number;
  /** 剧集：季号 */
  seasonNumber?: number | null;
  /** 剧集：集号 */
  episodeNumber?: number | null;
  /** 观看时间 */
  createdAt: Date;
}

export interface RecentlyWatchedResponse {
  results: RecentlyWatchedItem[];
}
