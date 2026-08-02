import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';

/**
 * MoviePilot API 客户端（原生 /api/v1/subscribe 接口）。
 *
 * 按 Mediary 的模式实现，作为 seerr 的后端下载服务接入 MoviePilot。
 * MoviePilot 官方文档：https://wiki.movie-pilot.org/  API 文档：https://api.movie-pilot.org/
 *
 * 鉴权方式（本地实例实测确认）：
 * - API_TOKEN 通过查询参数 `token` 传递（如 `?token=xxx`），客户端已注入到每个请求。
 * - `X-API-KEY` 请求头在 `/subscribe/list` 上实测返回 401，仅 `token` 查询参数可靠，
 *   因此本客户端不使用 Header 方式。
 *
 * 已实测端点（本机 v2 实例，只读）：
 * - `GET /api/v1/subscribe/list`  → 返回订阅数组（可作连接测试，对应 Mediary 的
 *   `GET /api/subscriptions?limit=1`）。
 * - `GET /api/v1/download/`       → 返回下载任务数组。
 * - `GET /api/v1/system/ping`     → 服务存活检测。
 * - `GET /api/v1/download/clients` → 可用下载器（订阅的 downloader 字段取值）。
 * - `GET /api/v1/download/paths`   → 可用下载路径（订阅的 save_path 字段取值）。
 * - `GET /api/v1/site/`            → 已维护站点列表（订阅的 sites 字段取值）。
 *
 * 写操作契约（来自 MoviePilot v2 源码 app/api/endpoints/subscribe.py）：
 * - `POST /api/v1/subscribe/` 新增订阅：请求体为 Subscribe 的公共可写字段
 *   （`tmdbid`、`media_source`、`media_id`、`type`、`name`、`year`、`season` 等），
 *   `type` 取 MediaType 枚举值：`电影` / `电视剧`；返回 `{success, message, data:{id}}`。
 * - `DELETE /api/v1/subscribe/{subscribe_id}` 按订阅 ID 删除订阅。
 *   → 与 Mediary 相同，删除采用「先查列表 → 按 tmdbid/季过滤 → 逐个删除」的两步模式。
 *
 * 字段契约：
 * - 订阅对象（`GET /api/v1/subscribe/list` 返回数组）：`id`, `name`, `year`, `type`,
 *   `tmdbid`, `media_source`, `media_id`, `season`, `state`(R-订阅中/P-暂停/S-完成),
 *   `total_episode`, `completed_episode`, `lack_episode`, `note`(缺失集列表),
 *   `username`, `downloader`, `save_path`, `sites`, `quality`/`resolution`/`effect` 等。
 * - 下载项（`GET /api/v1/download/` 返回数组）：`downloader`, `hash`, `title`, `name`,
 *   `year`, `season_episode`, `path`, `size`, `progress`, `state`(如 downloading/completed),
 *   `upspeed`, `dlspeed`, `save_path`, `category`, `media`{tmdbid,type,title,season,episode,image},
 *   `username` 等。
 *
 * 未确认的缺口：
 * - 新增/删除订阅未做真实写操作实测（避免在本机实例触发真实下载），参数以源码契约为准。
 * - `GET /api/v1/subscribe/media/{mediaid}` 实测对已存在订阅返回空对象，不可用于状态查询，
 *   因此状态查询统一走 `/api/v1/subscribe/list` + 客户端过滤。
 */

export interface MoviePilotServerSettings {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl?: string;
  isDefault: boolean;
  externalUrl?: string;
  syncEnabled: boolean;
}

/** MoviePilot MediaType 枚举值（订阅的 `type` 字段）。 */
const MOVIEPILOT_TYPE_MOVIE = '电影';
const MOVIEPILOT_TYPE_TV = '电视剧';
/** 本客户端统一使用 TMDB 作为媒体数据源。 */
const MOVIEPILOT_MEDIA_SOURCE = 'themoviedb';

export interface MoviePilotSubscribeOptions {
  tmdbid: number;
  type: 'movie' | 'tv';
  name?: string;
  year?: number;
  seasons?: string;
  // 订阅级配置（对应 Sonarr/Radarr 的 profile/rootFolder/tags，来自服务器默认配置或请求级覆盖）
  quality?: string;
  resolution?: string;
  effect?: string;
  downloader?: string;
  savePath?: string;
  sites?: number[];
  include?: string;
  exclude?: string;
}

/** 订阅对象中本客户端用于过滤与状态判断的最小字段集。 */
export interface MoviePilotSubscription {
  id?: number | null;
  tmdbid?: number | null;
  season?: number | null;
  type?: string | null;
  state?: string | null;
}

class MoviePilotAPI extends ExternalAPI {
  static buildUrl(settings: MoviePilotServerSettings, path?: string): string {
    return `${settings.useSsl ? 'https' : 'http'}://${settings.hostname}:${
      settings.port
    }${settings.baseUrl ?? ''}${path ?? ''}`;
  }

  private apiKey: string;

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    const timeout = getSettings().network.apiRequestTimeout;

    super(
      url,
      // MoviePilot API_TOKEN 鉴权：每个请求自动携带 `token` 查询参数（实测有效）。
      { token: apiKey },
      {
        timeout,
      }
    );

    this.apiKey = apiKey;
  }

  public getSystemStatus = async (): Promise<Record<string, unknown>> => {
    try {
      const response = await this.axios.get<Record<string, unknown>>(
        '/api/v1/subscribe/list',
        {
          params: { limit: 1 },
        }
      );
      return response.data;
    } catch (e) {
      let detail = e.message;
      if (e.response) {
        detail = `${e.response.status} ${e.response.statusText}: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(`[MoviePilot] Failed to connect: ${detail}`, {
        cause: e,
      });
    }
  };

  public async addSubscribe(
    options: MoviePilotSubscribeOptions
  ): Promise<Record<string, unknown>> {
    try {
      const payload: Record<string, unknown> = {
        tmdbid: options.tmdbid,
        media_source: MOVIEPILOT_MEDIA_SOURCE,
        media_id: String(options.tmdbid),
        type:
          options.type === 'movie' ? MOVIEPILOT_TYPE_MOVIE : MOVIEPILOT_TYPE_TV,
        name: options.name ?? '',
      };

      if (options.year) {
        payload.year = String(options.year);
      }

      if (options.type === 'tv' && options.seasons) {
        payload.season = Number(options.seasons);
      }

      if (options.quality) {
        payload.quality = options.quality;
      }
      if (options.resolution) {
        payload.resolution = options.resolution;
      }
      if (options.effect) {
        payload.effect = options.effect;
      }
      if (options.downloader) {
        payload.downloader = options.downloader;
      }
      if (options.savePath) {
        payload.save_path = options.savePath;
      }
      if (options.sites && options.sites.length > 0) {
        payload.sites = options.sites;
      }
      if (options.include) {
        payload.include = options.include;
      }
      if (options.exclude) {
        payload.exclude = options.exclude;
      }

      const response = await this.axios.post<Record<string, unknown>>(
        '/api/v1/subscribe/',
        payload
      );
      return response.data;
    } catch (e) {
      let detail = e.message;
      if (e.response?.data) {
        detail += `: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(`[MoviePilot] Failed to add subscribe: ${detail}`, {
        cause: e,
      });
    }
  }

  /**
   * 查询 MoviePilot 全部订阅（供状态查询、去重预检与定时同步使用）。
   */
  public async getSubscriptions(): Promise<MoviePilotSubscription[]> {
    try {
      const response = await this.axios.get<
        Record<string, unknown> | MoviePilotSubscription[]
      >('/api/v1/subscribe/list');

      const data = response.data;
      // 实测 /subscribe/list 直接返回数组；兼容 {data:[...]} 包装。
      if (Array.isArray(data)) {
        return data as unknown as MoviePilotSubscription[];
      }
      const wrapped = data as { data?: unknown[] } | undefined;
      return (wrapped?.data ?? []) as unknown as MoviePilotSubscription[];
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to get subscriptions: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async deleteSubscribe(
    tmdbid: number,
    season?: number
  ): Promise<Record<string, unknown>> {
    try {
      const subscriptions = await this.getSubscriptions();

      const matches = subscriptions.filter(
        (sub) =>
          sub.tmdbid === tmdbid &&
          (season === undefined || sub.season === season)
      );

      if (matches.length === 0) {
        throw new Error(
          `No subscription found for tmdb_id=${tmdbid}${
            season !== undefined ? ` season=${season}` : ''
          }`
        );
      }

      for (const sub of matches) {
        if (sub.id === null || sub.id === undefined) {
          continue;
        }

        const response = await this.axios.delete<Record<string, unknown>>(
          `/api/v1/subscribe/${sub.id}`
        );
        return response.data;
      }

      throw new Error(`No valid subscription id found for tmdb_id=${tmdbid}`);
    } catch (e) {
      let detail = e.message;
      if (e.response?.data) {
        detail += `: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(`[MoviePilot] Failed to delete subscribe: ${detail}`, {
        cause: e,
      });
    }
  }

  /**
   * 查询某媒体（按 tmdbid）在 MoviePilot 中的全部订阅。
   * 用于推送前的去重预检：MoviePilot 服务端按 tmdbid+season+media_source 精确去重，
   * 跨媒体源（如豆瓣来源的订阅）会绕过去重，因此这里按 tmdbid 匹配、返回全部结果。
   */
  public async getSubscriptionsByTmdbId(
    tmdbid: number
  ): Promise<MoviePilotSubscription[]> {
    try {
      const subscriptions = await this.getSubscriptions();
      return subscriptions.filter((sub) => sub.tmdbid === tmdbid);
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to get subscriptions for tmdb_id=${tmdbid}: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getSubscriptionStatus(
    tmdbid: number,
    type: 'movie' | 'tv'
  ): Promise<Record<string, unknown>> {
    try {
      const subscriptions = await this.getSubscriptions();

      const matches = subscriptions.filter((sub) => sub.tmdbid === tmdbid);
      if (matches.length === 0) {
        return {};
      }

      const expectedType =
        type === 'movie' ? MOVIEPILOT_TYPE_MOVIE : MOVIEPILOT_TYPE_TV;
      const match =
        matches.find((sub) => sub.type === expectedType) ?? matches[0];

      return match as unknown as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to get subscription status: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getDownloads(): Promise<Record<string, unknown>[]> {
    try {
      const response = await this.axios.get<
        Record<string, unknown> | Record<string, unknown>[]
      >('/api/v1/download/');

      const data = response.data;
      // 实测 /download/ 直接返回数组；兼容 {items:[...]} / {data:[...]} 包装。
      if (Array.isArray(data)) {
        return data;
      }
      const wrapped = data as { items?: unknown[]; data?: unknown[] };
      return (wrapped.items ?? wrapped.data ?? []) as Record<string, unknown>[];
    } catch (e) {
      throw new Error(`[MoviePilot] Failed to get downloads: ${e.message}`, {
        cause: e,
      });
    }
  }

  /**
   * 查询可用下载器（对应 Sonarr/Radarr 的 quality profile 之外的下载目标选择）。
   * 实测 `GET /api/v1/download/clients` 返回形如 `[{name: "qb", type: "qbittorrent"}]`。
   */
  public async getDownloadClients(): Promise<
    { name: string; type?: string }[]
  > {
    try {
      const response = await this.axios.get<
        { name: string; type?: string } | { name: string; type?: string }[]
      >('/api/v1/download/clients');

      const data = response.data;
      if (Array.isArray(data)) {
        return data;
      }
      return (data as { data?: { name: string; type?: string }[] }).data ?? [];
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to get download clients: ${e.message}`,
        {
          cause: e,
        }
      );
    }
  }

  /**
   * 查询可用下载路径（对应 Sonarr/Radarr 的 root folder 下拉）。
   * 实测 `GET /api/v1/download/paths` 返回数组，元素含 `name`/`save_path`/`media_type`。
   */
  public async getDownloadPaths(): Promise<
    { name?: string; save_path?: string; media_type?: string }[]
  > {
    try {
      const response = await this.axios.get<
        | { name?: string; save_path?: string; media_type?: string }
        | { name?: string; save_path?: string; media_type?: string }[]
      >('/api/v1/download/paths');

      const data = response.data;
      if (Array.isArray(data)) {
        return data;
      }
      return (
        (
          data as {
            data?: { name?: string; save_path?: string; media_type?: string }[];
          }
        ).data ?? []
      );
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to get download paths: ${e.message}`,
        {
          cause: e,
        }
      );
    }
  }

  /**
   * 查询已维护的站点列表（对应 Sonarr/Radarr 的 tag 下拉，用于限定订阅搜索范围）。
   * 实测 `GET /api/v1/site/` 返回数组，元素含 `id`/`name`/`domain`/`is_active`。
   */
  public async getSiteList(): Promise<
    { id: number; name?: string; domain?: string; is_active?: boolean }[]
  > {
    try {
      const response = await this.axios.get<
        | { id: number; name?: string; domain?: string; is_active?: boolean }
        | {
            id: number;
            name?: string;
            domain?: string;
            is_active?: boolean;
          }[]
      >('/api/v1/site/');

      const data = response.data;
      if (Array.isArray(data)) {
        return data;
      }
      return (
        (
          data as {
            data?: {
              id: number;
              name?: string;
              domain?: string;
              is_active?: boolean;
            }[];
          }
        ).data ?? []
      );
    } catch (e) {
      throw new Error(`[MoviePilot] Failed to get sites: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default MoviePilotAPI;
