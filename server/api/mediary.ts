import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';

/**
 * Mediary API 客户端。
 *
 * Mediary 完整开发者文档（API 契约 / 插件 / Webhook / 字段）：
 * https://github.com/KyleYu2024/Mediary-Plugins
 * 插件开发指南：docs/PLUGIN_DEVELOPMENT.md
 * 官方插件源码：official/（含订阅对象字段定义）
 *
 * 已确认的字段契约（文档 + 本地实例实测）：
 * - 订阅对象（`GET /subscriptions?tmdb_id=&media_type=` 返回数组）：
 *   `id`, `name`, `year`, `media_type`, `tmdb_id`, `season`, `state`(active/paused),
 *   `pause_reason`, `expected_episodes`, `collected_episodes`, `processing_count`,
 *   `poster_path`, `backdrop_path` 等。
 *   → 注意：订阅对象【没有】 `status` 字段；状态用 `state`，进度用
 *     `collected_episodes` / `expected_episodes`。
 * - 下载项（`GET /downloads?tmdb_id=&media_type=` 返回数组；无参数时可能返回单个对象）：
 *   `id`, `hash`, `name`, `status`(如 completed), `progress`(0-100), `size`(字节),
 *   `is_completed`, `is_paused`, `download_speed`, `upload_speed`, `tmdb_id`,
 *   `media_type`, `source_season`, `source_episode`, `target_season`, `target_episode`,
 *   `save_path`, `category`, `source_site`, `created_at`, `completed_at`。
 *   → `getDownloads()` 目前按数组解析，需兼容无参数时返回单个对象的情况。
 * - Webhook 事件（v1）：仅 `subscription.created` / `subscription.deleted`，
 *   目前没有下载失败/订阅失败事件。
 *
 * 未确认的缺口：
 * - 下载项 `status` 的完整取值集合（completed/下载中/失败等）尚未枚举，
 *   实现 MEDIA_FAILED 检测前需确认失败时的取值（观察或 Mediary 源码）。
 * - `/api/notifications` 不在文档的可授权路由中（插件用的是 `/plugin/notifications`），
 *   需向 Mediary 侧确认主 API 是否有该端点。
 *
 * 后续对接 Mediary 前，请先按上述契约核对字段，再补充 API 方法。
 */

export interface MediaryServerSettings {
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

interface MediarySubscribeOptions {
  tmdbid: number;
  type: 'movie' | 'tv';
  name?: string;
  year?: number;
  seasons?: string;
}

class MediaryAPI extends ExternalAPI {
  static buildUrl(settings: MediaryServerSettings, path?: string): string {
    return `${settings.useSsl ? 'https' : 'http'}://${settings.hostname}:${
      settings.port
    }${settings.baseUrl ?? ''}${path ?? ''}`;
  }

  private apiKey: string;

  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    const timeout = getSettings().network.apiRequestTimeout;

    super(
      url,
      {},
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout,
      }
    );

    this.apiKey = apiKey;
  }

  public getSystemStatus = async (): Promise<Record<string, unknown>> => {
    try {
      const response = await this.axios.get<Record<string, unknown>>(
        '/api/subscriptions',
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
      throw new Error(`[Mediary] Failed to connect: ${detail}`, { cause: e });
    }
  };

  public async addSubscribe(
    options: MediarySubscribeOptions
  ): Promise<Record<string, unknown>> {
    try {
      const payload: Record<string, unknown> = {
        tmdb_id: options.tmdbid,
        media_type: options.type,
        name: options.name ?? '',
      };

      if (options.year) {
        payload.year = options.year;
      }

      if (options.type === 'tv' && options.seasons) {
        payload.season = Number(options.seasons);
      }

      const response = await this.axios.post<Record<string, unknown>>(
        '/api/subscriptions',
        payload
      );
      return response.data;
    } catch (e) {
      let detail = e.message;
      if (e.response?.data) {
        detail += `: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(`[Mediary] Failed to add subscribe: ${detail}`, {
        cause: e,
      });
    }
  }

  public async deleteSubscribe(
    tmdbid: number,
    season?: number
  ): Promise<Record<string, unknown>> {
    try {
      const listResponse = await this.axios.get<Record<string, unknown>>(
        '/api/subscriptions',
        {
          params: { tmdb_id: tmdbid },
        }
      );

      const data = listResponse.data as Record<string, unknown>;
      const subscriptions =
        (data.items as Record<string, unknown>[]) ??
        (data.subscriptions as Record<string, unknown>[]) ??
        (Array.isArray(data)
          ? (data as unknown as Record<string, unknown>[])
          : null);

      if (!subscriptions || subscriptions.length === 0) {
        throw new Error(`No subscription found for tmdb_id=${tmdbid}`);
      }

      for (const sub of subscriptions) {
        if ((sub.tmdb_id as number) !== tmdbid) continue;

        if (season !== undefined && (sub.season as number) !== season) continue;

        const subId = sub.id as number;
        const response = await this.axios.delete<Record<string, unknown>>(
          `/api/subscriptions/${subId}`
        );
        return response.data;
      }

      throw new Error(
        `No matching subscription found for tmdb_id=${tmdbid} season=${season}`
      );
    } catch (e) {
      let detail = e.message;
      if (e.response?.data) {
        detail += `: ${JSON.stringify(e.response.data)}`;
      }
      throw new Error(`[Mediary] Failed to delete subscribe: ${detail}`, {
        cause: e,
      });
    }
  }

  public async getSubscriptionStatus(
    tmdbid: number,
    type: 'movie' | 'tv'
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.axios.get<Record<string, unknown>>(
        '/api/subscriptions',
        {
          params: { tmdb_id: tmdbid, media_type: type },
        }
      );

      const subscriptions =
        ((response.data as { items?: Record<string, unknown>[] })
          ?.items as Record<string, unknown>[]) ??
        ((response.data as { subscriptions?: Record<string, unknown>[] })
          ?.subscriptions as Record<string, unknown>[]) ??
        [];

      if (subscriptions.length > 0) {
        return subscriptions[0] as Record<string, unknown>;
      }

      return {};
    } catch (e) {
      throw new Error(
        `[Mediary] Failed to get subscription status: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getDownloads(): Promise<Record<string, unknown>[]> {
    try {
      const response =
        await this.axios.get<Record<string, unknown>>('/api/downloads');
      const data = response.data as
        | { items?: Record<string, unknown>[] }
        | Record<string, unknown>[];
      return (
        (data as { items?: Record<string, unknown>[] }).items ??
        (data as Record<string, unknown>[])
      );
    } catch (e) {
      throw new Error(`[Mediary] Failed to get downloads: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default MediaryAPI;
