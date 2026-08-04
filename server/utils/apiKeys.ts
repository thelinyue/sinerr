import { getSettings } from '@server/lib/settings';

/**
 * Third-party API keys.
 *
 * The defaults are shared public keys (the same approach used by
 * Overseerr/Jellyseerr) so the app works out of the box. Operators can
 * override them via environment variables to use their own keys.
 */

const DEFAULT_TMDB_API_KEY = '3fd52e6951387635a3710416b83d40d6';

/**
 * 解析实际使用的 TMDB API Key（优先级从高到低）：
 * 1. 环境变量 TMDB_API_KEY（部署级覆盖）
 * 2. 设置页保存的 settings.main.tmdbkey（UI 可配置）
 * 3. 内置共享公开 key（开箱即用兜底）
 *
 * 返回一个函数而非常量：设置页修改 key 后无需重启即可生效。
 */
export const getTMDBKey = (): string =>
  process.env.TMDB_API_KEY ||
  getSettings().main.tmdbkey ||
  DEFAULT_TMDB_API_KEY;

export const TVDB_API_KEY =
  process.env.TVDB_API_KEY || 'd00d9ecb-a9d0-4860-958a-74b14a041405';

export const ROTTEN_TOMATOES_ALGOLIA_API_KEY =
  process.env.ROTTEN_TOMATOES_ALGOLIA_API_KEY ||
  '175588f6e5f8319b27702e4cc4013561';
