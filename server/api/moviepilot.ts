import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';

export interface MoviePilotSettings {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl?: string;
  isDefault: boolean;
  externalUrl?: string;
}

interface MoviePilotSubscribeOptions {
  tmdbid: number;
  type: 'movie' | 'tv';
  name?: string;
  year?: number;
  seasons?: string;
}

interface MoviePilotSinerrPayload {
  notification_type: string;
  subject: string;
  media: {
    media_type: string;
    tmdbId: number;
  };
  request: {
    requestedBy_username: string;
  };
  extra?: { name: string; value: string }[];
}

interface MoviePilotResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
}

interface MoviePilotSystemStatus {
  version?: string;
  [key: string]: unknown;
}

class MoviePilotAPI extends ExternalAPI {
  static buildUrl(settings: MoviePilotSettings, path?: string): string {
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
          'X-Api-Key': apiKey,
        },
        timeout,
      }
    );

    this.apiKey = apiKey;
  }

  public getSystemStatus = async (): Promise<MoviePilotSystemStatus> => {
    try {
      const response =
        await this.axios.get<MoviePilotSystemStatus>('/api/v1/user');
      return response.data;
    } catch (e) {
      throw new Error(
        `[MoviePilot] Failed to retrieve system status: ${e.message}`,
        { cause: e }
      );
    }
  };

  public async addSubscribe(
    options: MoviePilotSubscribeOptions
  ): Promise<MoviePilotResponse> {
    try {
      const payload: MoviePilotSinerrPayload = {
        notification_type: 'MEDIA_APPROVED',
        subject: options.name ?? '',
        media: {
          media_type: options.type,
          tmdbId: options.tmdbid,
        },
        request: {
          requestedBy_username: 'sinerr',
        },
      };

      if (options.type === 'tv' && options.seasons) {
        payload.extra = [
          {
            name: 'Requested Seasons',
            value: options.seasons,
          },
        ];
      }

      const response = await axios.post<MoviePilotResponse>(
        `${this.axios.defaults.baseURL}/api/v1/subscribe/sinerr`,
        payload,
        {
          headers: {
            Authorization: this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: getSettings().network.apiRequestTimeout,
        }
      );
      return response.data;
    } catch (e) {
      throw new Error(`[MoviePilot] Failed to add subscribe: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async deleteSubscribe(
    tmdbid: number,
    season?: number
  ): Promise<MoviePilotResponse> {
    try {
      const params = new URLSearchParams({
        token: this.apiKey,
      });
      if (season !== undefined) {
        params.append('season', String(season));
      }

      const response = await this.axios.delete<MoviePilotResponse>(
        `/api/v1/subscribe/media/tmdb:${tmdbid}?${params.toString()}`
      );
      return response.data;
    } catch (e) {
      throw new Error(`[MoviePilot] Failed to delete subscribe: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default MoviePilotAPI;
