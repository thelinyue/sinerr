/* eslint-disable @typescript-eslint/no-explicit-any */
import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import availabilitySync from '@server/lib/availabilitySync';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';
import type NodeCache from 'node-cache';

export interface JellyfinUserPolicy {
  IsAdministrator: boolean;
  IsHidden: boolean;
  IsDisabled: boolean;
  EnableRemoteControlOfOtherUsers: boolean;
  EnableSharedDeviceControl: boolean;
  EnableRemoteAccess: boolean;
  EnableLiveTvManagement: boolean;
  EnableLiveTvAccess: boolean;
  EnableMediaPlayback: boolean;
  EnableAudioPlaybackTranscoding: boolean;
  EnableVideoPlaybackTranscoding: boolean;
  EnablePlaybackRemuxing: boolean;
  EnableContentDeletion: boolean;
  EnableContentDownloading: boolean;
  EnableSubtitleDownloading: boolean;
  EnableSubtitleManagement: boolean;
  EnableSyncTranscoding: boolean;
  EnableMediaConversion: boolean;
  EnableAllChannels: boolean;
  EnableAllDevices: boolean;
  EnablePublicSharing: boolean;
  BlockedChannels: string[];
  BlockedTags: string[];
  BlockedMediaFolders: string[];
  EnabledDevices: string[];
  EnabledChannels: string[];
  EnabledFolders: string[];
}

export interface JellyfinUserResponse {
  Name: string;
  ServerId: string;
  ServerName: string;
  Id: string;
  Configuration: {
    GroupedFolders: string[];
  };
  Policy: {
    IsAdministrator: boolean;
  };
  PrimaryImageTag?: string;
}

export interface JellyfinUserResponseFull extends JellyfinUserResponse {
  Policy: JellyfinUserPolicy;
}

export interface JellyfinDevice {
  Id: string;
  Name: string;
  LastUserName: string;
  AppName: string;
  AppVersion: string;
  LastUserId: string;
  DateLastActivity: string;
  Capabilities: Record<string, unknown>;
}

export interface JellyfinDevicesResponse {
  Items: JellyfinDevice[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinLoginResponse {
  User: JellyfinUserResponse;
  AccessToken: string;
}

export interface JellyfinUserListResponse {
  users: JellyfinUserResponse[];
}

interface JellyfinMediaFolder {
  Name: string;
  Id: string;
  Type: string;
  CollectionType: string;
}

export interface JellyfinLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

export interface JellyfinLibraryItem {
  Name: string;
  Id: string;
  HasSubtitles: boolean;
  Type: 'Movie' | 'Episode' | 'Season' | 'Series';
  LocationType: 'FileSystem' | 'Offline' | 'Remote' | 'Virtual';
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  ParentIndexNumber?: number;
  MediaType: string;
}

export interface JellyfinMediaStream {
  Codec: string;
  Type: 'Video' | 'Audio' | 'Subtitle';
  Height?: number;
  Width?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Language?: string;
  DisplayTitle: string;
}

export interface JellyfinMediaSource {
  Protocol: string;
  Id: string;
  Path: string;
  Type: string;
  VideoType: string;
  MediaStreams: JellyfinMediaStream[];
}

export interface JellyfinLibraryItemExtended extends JellyfinLibraryItem {
  ProviderIds: {
    Tmdb?: string;
    TheMovieDb?: string;
    Imdb?: string;
    Tvdb?: string;
    AniDB?: string;
  };
  MediaSources?: JellyfinMediaSource[];
  Width?: number;
  Height?: number;
  IsHD?: boolean;
  DateCreated?: string;
}

type EpisodeReturn<T> = T extends { includeMediaInfo: true }
  ? JellyfinLibraryItemExtended[]
  : JellyfinLibraryItem[];

export interface JellyfinItemsReponse {
  Items: JellyfinLibraryItemExtended[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinPlaybackReportItem {
  ItemId: string;
  ItemName: string;
  ItemType: string;
  PlayCount: number;
}

class JellyfinAPI extends ExternalAPI {
  private userId?: string;
  private mediaServerType: MediaServerType;

  constructor(
    jellyfinHost: string,
    authToken?: string | null,
    deviceId?: string | null,
    mediaServerType?: MediaServerType,
    nodeCache?: NodeCache
  ) {
    const settings = getSettings();
    const safeDeviceId =
      deviceId && deviceId.length > 0
        ? deviceId
        : Buffer.from('BOT_sinerr').toString('base64');

    const resolvedType = mediaServerType ?? settings.main.mediaServerType;
    const version =
      resolvedType === MediaServerType.EMBY ? '1.0.0' : getAppVersion();

    let authHeaderVal = `MediaBrowser Client="Sinerr", Device="Sinerr", DeviceId="${safeDeviceId}", Version="${version}"`;
    if (authToken) {
      authHeaderVal += `, Token="${authToken}"`;
    }

    super(
      jellyfinHost,
      {},
      {
        headers: {
          Authorization: authHeaderVal,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Connection: 'close',
        },
        timeout: settings.network.apiRequestTimeout,
        nodeCache,
      }
    );

    this.mediaServerType = resolvedType;
  }

  public async login(
    Username?: string,
    Password?: string,
    ClientIP?: string
  ): Promise<JellyfinLoginResponse> {
    const authenticate = async (useHeaders: boolean) => {
      const headers =
        useHeaders && ClientIP ? { 'X-Forwarded-For': ClientIP } : {};

      return this.post<JellyfinLoginResponse>(
        '/Users/AuthenticateByName',
        {
          Username,
          Pw: Password,
        },
        { headers }
      );
    };

    try {
      return await authenticate(true);
    } catch (e) {
      logger.debug('Failed to authenticate with headers', {
        label: 'Jellyfin API',
        error: e.response?.statusText,
        ip: ClientIP,
      });

      if (!e.response?.status) {
        throw new ApiError(404, ApiErrorCode.InvalidUrl);
      }

      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }
    }

    try {
      return await authenticate(false);
    } catch (e) {
      if (e.response?.status === 401) {
        throw new ApiError(e.response?.status, ApiErrorCode.InvalidCredentials);
      }

      logger.error(
        `Something went wrong while authenticating with the Jellyfin server: ${e.message}`,
        {
          label: 'Jellyfin API',
          error: e.response?.status,
          ip: ClientIP,
        }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public setUserId(userId: string): void {
    this.userId = userId;
    return;
  }

  public async getSystemInfo(): Promise<any> {
    try {
      const systemInfoResponse = await this.get<any>('/System/Info');

      return systemInfoResponse;
    } catch (e) {
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getServerName(): Promise<string> {
    try {
      const serverResponse = await this.get<JellyfinUserResponse>(
        '/System/Info/Public'
      );

      return serverResponse.ServerName;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the server name from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public async getUsers(): Promise<JellyfinUserListResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse[]>(
        `/Users`,
        undefined,
        60
      );

      return { users: userReponse };
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUser(): Promise<JellyfinUserResponse> {
    try {
      const userReponse = await this.get<JellyfinUserResponse>(
        `/Users/${this.userId ?? 'Me'}`
      );
      return userReponse;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the account from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getUserById(userId: string): Promise<JellyfinUserResponseFull> {
    try {
      const userResponse = await this.get<JellyfinUserResponseFull>(
        `/Users/${userId}`
      );
      return userResponse;
    } catch (e) {
      logger.error(
        `Something went wrong while getting user from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async updateUserPolicy(
    userId: string,
    policy: Partial<JellyfinUserPolicy>
  ): Promise<void> {
    try {
      await this.post(`/Users/${userId}/Policy`, policy);
    } catch (e) {
      logger.error(
        `Something went wrong while updating user policy on the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public async getLibraries(): Promise<JellyfinLibrary[]> {
    try {
      const mediaFolderResponse = await this.get<any>(`/Library/MediaFolders`);

      return this.mapLibraries(mediaFolderResponse.Items);
    } catch {
      // fallback to user views to get libraries
      // this only and maybe/depending on factors affects LDAP users
      try {
        const mediaFolderResponse = await this.get<any>(
          `/Users/${this.userId ?? 'Me'}/Views`
        );

        return this.mapLibraries(mediaFolderResponse.Items);
      } catch (e) {
        logger.error(
          `Something went wrong while getting libraries from the Jellyfin server: ${e.message}`,
          {
            label: 'Jellyfin API',
            error: e.response?.status,
          }
        );

        return [];
      }
    }
  }

  private mapLibraries(mediaFolders: JellyfinMediaFolder[]): JellyfinLibrary[] {
    const excludedTypes = [
      'music',
      'books',
      'musicvideos',
      'homevideos',
      'boxsets',
    ];

    return mediaFolders
      .filter((Item: JellyfinMediaFolder) => {
        return (
          Item.Type === 'CollectionFolder' &&
          !excludedTypes.includes(Item.CollectionType)
        );
      })
      .map((Item: JellyfinMediaFolder) => {
        return <JellyfinLibrary>{
          key: Item.Id,
          title: Item.Name,
          type: Item.CollectionType === 'movies' ? 'movie' : 'show',
          agent: 'jellyfin',
        };
      });
  }

  public async getLibraryContents(id: string): Promise<JellyfinLibraryItem[]> {
    try {
      const libraryItemsResponse = await this.get<any>(
        `/Items?SortBy=SortName&SortOrder=Ascending&IncludeItemTypes=Series,Movie,Others&Recursive=true&StartIndex=0&ParentId=${id}&collapseBoxSetItems=false`
      );

      return libraryItemsResponse.Items.filter(
        (item: JellyfinLibraryItem) => item.LocationType !== 'Virtual'
      );
    } catch (e) {
      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e?.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getRecentlyAdded(id: string): Promise<JellyfinLibraryItem[]> {
    try {
      const endpoint =
        this.mediaServerType === MediaServerType.JELLYFIN
          ? `/Items/Latest`
          : `/Users/${this.userId}/Items/Latest`;
      const itemResponse = await this.get<any>(
        `${endpoint}?Limit=12&ParentId=${id}${
          this.mediaServerType === MediaServerType.JELLYFIN
            ? `&userId=${this.userId ?? 'Me'}`
            : ''
        }`
      );

      return itemResponse;
    } catch (e) {
      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getItemData(
    id: string
  ): Promise<JellyfinLibraryItemExtended | undefined> {
    try {
      const itemResponse = await this.get<JellyfinItemsReponse>(`/Items`, {
        params: {
          ids: id,
          fields: 'ProviderIds,MediaSources,Width,Height,IsHD,DateCreated',
        },
      });

      return itemResponse.Items?.[0];
    } catch (e) {
      if (availabilitySync.running) {
        if (e.response?.status === 500) {
          return undefined;
        }
      }

      logger.error(
        `Something went wrong while getting library content from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getSeasons(seriesID: string): Promise<JellyfinLibraryItem[]> {
    try {
      const seasonResponse = await this.get<any>(`/Shows/${seriesID}/Seasons`);

      return seasonResponse.Items;
    } catch (e) {
      logger.error(
        `Something went wrong while getting the list of seasons from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getEpisodes<
    T extends { includeMediaInfo?: boolean } | undefined = undefined,
  >(
    seriesID: string,
    seasonID: string,
    options?: T
  ): Promise<EpisodeReturn<T>> {
    try {
      const episodeResponse = await this.get<any>(
        `/Shows/${seriesID}/Episodes`,
        {
          params: {
            seasonId: seasonID,
            ...(options?.includeMediaInfo && { fields: 'MediaSources' }),
          },
        }
      );

      return episodeResponse.Items.filter(
        (item: JellyfinLibraryItem) => item.LocationType !== 'Virtual'
      );
    } catch (e) {
      logger.error(
        `Something went wrong while getting the list of episodes from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async createUser(data: {
    Name: string;
    Password?: string;
  }): Promise<JellyfinUserResponse> {
    try {
      const response = await this.post<JellyfinUserResponse>('/Users/New', {
        Name: data.Name,
        Password: data.Password,
        HasPassword: true,
      });
      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while creating a user on the Jellyfin/Emby server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public async forgotPassword(username: string): Promise<{
    Action: string;
    PinFile?: string;
  }> {
    try {
      const response = await this.post<{
        Action: string;
        PinFile?: string;
      }>('/Users/ForgotPassword', {
        EnteredUsername: username,
      });
      return response;
    } catch (e) {
      logger.error(
        `Something went wrong while initiating forgot password on the Jellyfin/Emby server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public async forgotPasswordPin(
    pin: string,
    newPassword: string
  ): Promise<void> {
    try {
      await this.post('/Users/ForgotPassword/Pin', {
        Pin: pin,
        NewPassword: newPassword,
      });
    } catch (e) {
      logger.error(
        `Something went wrong while completing forgot password on the Jellyfin/Emby server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      throw new ApiError(e.response?.status, ApiErrorCode.Unknown);
    }
  }

  public async createApiToken(appName: string): Promise<string> {
    try {
      await this.post(`/Auth/Keys?App=${appName}`);
      const apiKeys = await this.get<any>(`/Auth/Keys`);
      return apiKeys.Items.reverse().find(
        (item: any) => item.AppName === appName
      ).AccessToken;
    } catch (e) {
      logger.error(
        `Something went wrong while creating an API key from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );

      throw new ApiError(e.response?.status, ApiErrorCode.InvalidAuthToken);
    }
  }

  public async getBatchItems(
    ids: string
  ): Promise<JellyfinLibraryItemExtended[]> {
    try {
      const itemResponse = await this.get<JellyfinItemsReponse>(`/Items`, {
        params: {
          ids,
          fields: 'ProviderIds',
        },
      });

      return itemResponse.Items || [];
    } catch (e) {
      logger.error(
        `Something went wrong while getting batch items from the Jellyfin server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      return [];
    }
  }

  public async getPlaybackReport(
    options: {
      days?: number;
      itemType?: string;
      limit?: number;
    } = {}
  ): Promise<JellyfinPlaybackReportItem[]> {
    const days = options.days ?? 7;
    const itemType = options.itemType ?? 'Movie';
    const limit = options.limit ?? 100;

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const dateStr = sinceDate.toISOString().split('T')[0];

    try {
      const conditions: string[] = [];
      if (days > 0) {
        conditions.push(`DateCreated >= '${dateStr}'`);
      }
      if (itemType) {
        conditions.push(`ItemType = '${itemType}'`);
      }
      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = [
        'SELECT ItemId, ItemName, ItemType, COUNT(ItemId) as PlayCount',
        'FROM PlaybackActivity',
        whereClause,
        'GROUP BY ItemId',
        'ORDER BY PlayCount DESC',
        `LIMIT ${limit}`,
      ]
        .filter(Boolean)
        .join(' ');

      logger.info('Executing playback report query', {
        label: 'Jellyfin API',
        query,
      });

      const response = await this.post<{
        colums: string[];
        results: unknown[][];
        message: string;
      }>('/user_usage_stats/submit_custom_query', {
        CustomQueryString: query,
        ReplaceUserId: false,
      });

      if (!response?.colums || !response?.results) {
        logger.warn('Playback report returned unexpected format', {
          label: 'Jellyfin API',
          responseKeys: response ? Object.keys(response) : 'null',
          responseType: typeof response,
        });
        return [];
      }

      logger.info('Playback report query result', {
        label: 'Jellyfin API',
        colums: response.colums,
        rowCount: response.results.length,
        message: response.message,
      });

      const colIdx: Record<string, number> = {};
      response.colums.forEach((col, i) => {
        colIdx[col] = i;
      });

      return response.results.map((row) => ({
        ItemId: String(row[colIdx['ItemId']] ?? ''),
        ItemName: String(row[colIdx['ItemName']] ?? ''),
        ItemType: String(row[colIdx['ItemType']] ?? ''),
        PlayCount: Number(row[colIdx['PlayCount']] ?? 0),
      }));
    } catch (e) {
      logger.error(
        `Something went wrong while getting playback report from the Jellyfin/Emby server: ${e.message}`,
        { label: 'Jellyfin API', error: e.response?.status }
      );
      return [];
    }
  }
}

export default JellyfinAPI;
