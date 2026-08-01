import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';

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
