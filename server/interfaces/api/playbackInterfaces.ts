/**
 * 播放进度接口类型
 *
 * 数据来自 Jellyfin/Emby 的 Playback Reporting 插件（PlaybackActivity 表），
 * 用于在媒体详情页 / 短评区展示当前用户对该媒体的观看状态。
 */
export interface PlaybackProgressResponse {
  /** 是否播放过（电影：有播放记录即视为已看；剧集：至少看过 1 集） */
  played: boolean;
  /** 播放次数 */
  playCount: number;
  /** 累计播放时长（秒） */
  playDurationSeconds: number;
  /** 已看集数（仅剧集返回） */
  watchedEpisodes?: number;
  /** 总集数（仅剧集返回） */
  totalEpisodes?: number;
  /** 已看集数百分比 0-100（仅剧集返回） */
  watchedPercent?: number;
  /** 按季进度（仅剧集返回，模块 3：插件 API 或 Episode 表本地聚合） */
  seasons?: {
    seasonNumber: number;
    watchedEpisodes: number;
    totalEpisodes: number;
  }[];
}
