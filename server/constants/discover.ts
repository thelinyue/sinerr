import type DiscoverSlider from '@server/entity/DiscoverSlider';

export enum DiscoverSliderType {
  /** 已废弃：2.0 起由「最近添加」轮播 Hero 取代，不再渲染（枚举值保留避免存量配置错位） */
  RECENTLY_ADDED = 1,
  RECENT_REQUESTS,
  TRENDING,
  POPULAR_MOVIES,
  MOVIE_GENRES,
  UPCOMING_MOVIES,
  STUDIOS,
  POPULAR_TV,
  TV_GENRES,
  UPCOMING_TV,
  NETWORKS,
  TMDB_MOVIE_KEYWORD,
  TMDB_MOVIE_GENRE,
  TMDB_TV_KEYWORD,
  TMDB_TV_GENRE,
  TMDB_SEARCH,
  TMDB_STUDIO,
  TMDB_NETWORK,
  TMDB_MOVIE_STREAMING_SERVICES,
  TMDB_TV_STREAMING_SERVICES,
  /** 已废弃：周排行榜由动态 Tab 的「本周热播」领奖台取代，不再渲染（枚举值保留避免存量配置错位） */
  MOST_PLAYED,
}

export const defaultSliders: Partial<DiscoverSlider>[] = [
  {
    type: DiscoverSliderType.RECENT_REQUESTS,
    enabled: true,
    isBuiltIn: true,
    order: 0,
  },
  {
    type: DiscoverSliderType.TRENDING,
    enabled: true,
    isBuiltIn: true,
    order: 2,
  },
  {
    type: DiscoverSliderType.POPULAR_MOVIES,
    enabled: true,
    isBuiltIn: true,
    order: 3,
  },
  {
    type: DiscoverSliderType.MOVIE_GENRES,
    enabled: true,
    isBuiltIn: true,
    order: 4,
  },
  {
    type: DiscoverSliderType.UPCOMING_MOVIES,
    enabled: true,
    isBuiltIn: true,
    order: 5,
  },
  {
    type: DiscoverSliderType.STUDIOS,
    enabled: true,
    isBuiltIn: true,
    order: 6,
  },
  {
    type: DiscoverSliderType.POPULAR_TV,
    enabled: true,
    isBuiltIn: true,
    order: 7,
  },
  {
    type: DiscoverSliderType.TV_GENRES,
    enabled: true,
    isBuiltIn: true,
    order: 8,
  },
  {
    type: DiscoverSliderType.UPCOMING_TV,
    enabled: true,
    isBuiltIn: true,
    order: 9,
  },
  {
    type: DiscoverSliderType.NETWORKS,
    enabled: true,
    isBuiltIn: true,
    order: 10,
  },
];
