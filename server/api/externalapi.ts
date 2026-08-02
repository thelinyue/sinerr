import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import type NodeCache from 'node-cache';

// 5 minute default TTL (in seconds)
const DEFAULT_TTL = 300;

// 10 seconds default rolling buffer (in ms)
const DEFAULT_ROLLING_BUFFER = 10000;

export interface ExternalAPIOptions {
  nodeCache?: NodeCache;
  headers?: Record<string, unknown>;
  timeout?: number;
  rateLimit?: {
    maxRPS: number;
    maxRequests: number;
  };
}

// Axios instances are rate-limited via a shared per-host instance so the
// queue actually accumulates across all ExternalAPI instances (otherwise each
// `new TheMovieDb()` creates a fresh limiter that never throttles anything).
const rateLimitedClients = new Map<string, AxiosInstance>();

class ExternalAPI {
  protected axios: AxiosInstance;
  private baseUrl: string;
  private cache?: NodeCache;

  constructor(
    baseUrl: string,
    params: Record<string, unknown>,
    options: ExternalAPIOptions = {}
  ) {
    const createClient = (): AxiosInstance => {
      const client = axios.create({
        baseURL: baseUrl,
        params,
        timeout: options.timeout,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options.headers,
        },
      });
      client.interceptors.request.use(proxyRequestInterceptor);
      return client;
    };

    if (options.rateLimit) {
      const existing = rateLimitedClients.get(baseUrl);
      if (existing) {
        this.axios = existing;
      } else {
        this.axios = rateLimit(createClient(), options.rateLimit);
        rateLimitedClients.set(baseUrl, this.axios);
      }
    } else {
      this.axios = createClient();
    }

    this.baseUrl = baseUrl;
    this.cache = options.nodeCache;
  }

  protected async get<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    // Headers are intentionally excluded from the cache key: auth tokens (e.g.
    // TVDB) refresh periodically and would otherwise invalidate every cached
    // entry even though the response content is identical.
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    const response = await this.axios.get<T>(endpoint, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected async post<T>(
    endpoint: string,
    data?: Record<string, unknown>,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      config: config?.params,
      ...(data ? { data } : {}),
    });

    const cachedItem = this.cache?.get<T>(cacheKey);
    if (cachedItem) {
      return cachedItem;
    }

    const response = await this.axios.post<T>(endpoint, data, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected async getRolling<T>(
    endpoint: string,
    config?: AxiosRequestConfig,
    ttl?: number
  ): Promise<T> {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...config?.params,
    });
    const cachedItem = this.cache?.get<T>(cacheKey);

    if (cachedItem) {
      const keyTtl = this.cache?.getTtl(cacheKey) ?? 0;

      // If the item has passed our rolling check, fetch again in background
      if (
        keyTtl - (ttl ?? DEFAULT_TTL) * 1000 <
        Date.now() - DEFAULT_ROLLING_BUFFER
      ) {
        this.axios.get<T>(endpoint, config).then((response) => {
          this.cache?.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
        });
      }
      return cachedItem;
    }

    const response = await this.axios.get<T>(endpoint, config);

    if (this.cache && ttl !== 0) {
      this.cache.set(cacheKey, response.data, ttl ?? DEFAULT_TTL);
    }

    return response.data;
  }

  protected removeCache(endpoint: string, options?: Record<string, unknown>) {
    const cacheKey = this.serializeCacheKey(endpoint, {
      ...options,
    });
    this.cache?.del(cacheKey);
  }

  private serializeCacheKey(
    endpoint: string,
    options?: Record<string, unknown>
  ) {
    if (!options) {
      return `${this.baseUrl}${endpoint}`;
    }

    return `${this.baseUrl}${endpoint}${JSON.stringify(options)}`;
  }
}

export default ExternalAPI;
