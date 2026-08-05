import type { MovieDetails } from '@server/models/Movie';

/**
 * 类型守卫：判断 TMDB 详情是电影还是剧集
 *
 * MovieDetails 有 `title` 字段，TvDetails 有 `name` 字段；
 * 全仓统一使用此守卫，避免各组件重复定义。
 * 入参放宽为 `unknown`，以兼容 BlocklistModal 等场景传入
 * `Collection | null` 等更宽联合类型（非电影时返回 false）。
 */
export const isMovie = (m: unknown): m is MovieDetails =>
  !!m && (m as MovieDetails).title !== undefined;
