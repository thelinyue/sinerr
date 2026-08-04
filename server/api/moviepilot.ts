import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';

/**
 * MoviePilot API 客户端（原生 /api/v1/subscribe 接口）。
 *
 * 作为 seerr 的后端下载服务接入 MoviePilot。
 * MoviePilot 官方文档：https://wiki.movie-pilot.org/  API 文档：https://api.movie-pilot.org/
 *
 * 鉴权方式（本地实例实测确认）：
 * - API_TOKEN 通过查询参数 `token` 传递（如 `?token=xxx`），客户端已注入到每个请求。
 * - `X-API-KEY` 请求头在 `/subscribe/list` 上实测返回 401，仅 `token` 查询参数可靠，
 *   因此本客户端不使用 Header 方式。
 *
 * 已实测端点（本机 v2 实例，只读）：
 * - `GET /api/v1/subscribe/list`  → 返回订阅数组。
 * - `GET /api/v1/download/`       → 返回下载任务数组。
 * - `GET /api/v1/system/ping`     → 服务存活检测。
 *
 * 写操作契约（来自 MoviePilot v2 源码 app/api/endpoints/subscribe.py）：
 * - `POST /api/v1/subscribe/seerr` 创建订阅（OverSeerr/JellySeerr 兼容端点）：
 *   载荷为 webhook 格式（`notification_type`/`subject`/`media`/`extra`/`request`），
 *   订阅的 username 取自 `request.requestedBy_username`（用于显示提交者），
 *   鉴权为 `Authorization: <API_TOKEN>` 请求头；异步创建（后台任务）。
 * - `DELETE /api/v1/subscribe/{subscribe_id}` 按订阅 ID 删除订阅。
 *   → 删除采用「先查列表 → 按 tmdbid/季过滤 → 逐个删除」的两步模式。
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

export interface MoviePilotSeerrOptions {
  tmdbid: number;
  type: 'movie' | 'tv';
  title: string;
  /** 提交者用户名，MoviePilot 侧订阅的 username 字段会显示为该值。 */
  username: string;
  /** 剧集订阅的季列表（电影忽略）。 */
  seasons?: number[];
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

  /**
   * 通过 MoviePilot 的 OverSeerr/JellySeerr 兼容端点（POST /api/v1/subscribe/seerr）
   * 创建订阅。该端点会取载荷里的 `requestedBy_username` 作为订阅的 username 字段，
   * 因此订阅可显示为提交者（如 `sinerr(ceshi)`）。
   *
   * 注意：seerr 端点不支持质量/路径/站点等订阅级配置，订阅按 MoviePilot 全局默认创建；
   * 且为异步执行（响应先返回，订阅在后台任务中创建）。
   */
  public async subscribeViaSeerrWebhook(
    options: MoviePilotSeerrOptions
  ): Promise<Record<string, unknown>> {
    try {
      const payload: Record<string, unknown> = {
        notification_type: 'MEDIA_APPROVED',
        subject: options.title,
        media: {
          media_type: options.type,
          tmdbId: options.tmdbid,
        },
        request: {
          requestedBy_username: options.username,
        },
      };

      if (
        options.type === 'tv' &&
        options.seasons &&
        options.seasons.length > 0
      ) {
        payload.extra = [
          {
            name: 'Requested Seasons',
            value: options.seasons.join(', '),
          },
        ];
      }

      const response = await this.axios.post<Record<string, unknown>>(
        '/api/v1/subscribe/seerr',
        payload,
        {
          headers: {
            // seerr 端点鉴权：Authorization 头直接放 API_TOKEN（无 Bearer 前缀）
            Authorization: this.apiKey,
          },
        }
      );
      return response.data;
    } catch (e) {
      let detail = e.message;
      if (e.response?.data) {
        detail += `: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(
        `[MoviePilot] Failed to send seerr subscribe: ${detail}`,
        {
          cause: e,
        }
      );
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
}

export default MoviePilotAPI;
