/**
 * Third-party API keys.
 *
 * The defaults are shared public keys (the same approach used by
 * Overseerr/Jellyseerr) so the app works out of the box. Operators can
 * override them via environment variables to use their own keys.
 */
export const TMDB_API_KEY =
  process.env.TMDB_API_KEY || '3fd52e6951387635a3710416b83d40d6';

export const TVDB_API_KEY =
  process.env.TVDB_API_KEY || 'd00d9ecb-a9d0-4860-958a-74b14a041405';

export const ROTTEN_TOMATOES_ALGOLIA_API_KEY =
  process.env.ROTTEN_TOMATOES_ALGOLIA_API_KEY ||
  '175588f6e5f8319b27702e4cc4013561';
