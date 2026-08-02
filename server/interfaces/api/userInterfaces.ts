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
