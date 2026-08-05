import type { MediaRequestStatus } from '@server/constants/media';
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

/**
 * 动态时间线条目（总览「动态」流：观看 / 剧集更新 / 请求 三源合并）
 */
export interface ActivityItem {
  /** 条目类型：观看事件 / 剧集更新事件 / 请求事件 */
  type: 'watch' | 'update' | 'request';
  /** 事件发生时间（观看=播放时间；更新=最新集入库时间；请求=请求创建时间） */
  createdAt: Date;
  /** 关联媒体（watch/update/request 均有） */
  media: { tmdbId: number; mediaType: 'movie' | 'tv' };
  /** 观看事件：是否看完 */
  completed?: boolean;
  /** 观看事件：本次播放时长（秒） */
  durationSeconds?: number;
  /** 观看事件：剧集季号 */
  seasonNumber?: number | null;
  /** 观看事件：剧集集号 */
  episodeNumber?: number | null;
  /** 更新事件：本次新增集数 */
  episodeCount?: number;
  /** 请求事件：当前请求状态 */
  requestStatus?: MediaRequestStatus;
}

export interface UserActivityResponse extends PaginatedResponse {
  results: ActivityItem[];
}

/**
 * 已看条目（插件 PlaybackActivity 权威查询 + 本地 Media/Episode 映射）
 */
export interface WatchedItem {
  /** 媒体 tmdbId */
  tmdbId: number;
  /** 媒体类型 */
  mediaType: 'movie' | 'tv';
  /** 播放次数（插件 PlayCount 或单集播放次数合计） */
  playCount: number;
  /** 累计播放时长（秒） */
  playDurationSeconds: number;
  /** 电影：是否看完（本地 PlaybackEvent completed 匹配）；剧集：是否看完 */
  completed?: boolean;
  /** 剧集：已看集数 */
  watchedCount?: number;
  /** 剧集：总集数 */
  totalCount?: number;
  /** 剧集：观看进度百分比（0-100） */
  watchedPercent?: number;
  /** 用户本地短评评分（1-5），未评分则为 null */
  rating?: number | null;
}

export interface UserWatchedResponse extends PaginatedResponse {
  results: WatchedItem[];
}

/**
 * 看剧报告（年度聚合）
 */
export interface ReportMonthItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  playCount: number;
  playDurationSeconds: number;
}

export interface ReportMonth {
  /** 月份（1-12） */
  month: number;
  /** 该月播放次数 */
  playCount: number;
  /** 该月播放时长（秒） */
  playDurationSeconds: number;
  /** 该月去重观看的媒体数 */
  titleCount: number;
  /** 该月观看明细（按播放次数倒序） */
  items: ReportMonthItem[];
}

export interface UserReportResponse {
  /** 统计年份 */
  year: number;
  /** 全年总播放时长（秒） */
  totalSeconds: number;
  /** 全年播放次数 */
  playCount: number;
  /** 全年去重观看的媒体数 */
  watchedTitles: number;
  /** 全年观看的电影数 */
  movieTitles: number;
  /** 全年观看的剧集数 */
  tvTitles: number;
  /** 金榜：按播放时长倒序的 TOP 条目 */
  topItems: ReportMonthItem[];
  /** 按月下钻 */
  months: ReportMonth[];
}
