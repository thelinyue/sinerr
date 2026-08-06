import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, type MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
import type { MediaRequestBody } from '@server/interfaces/api/requestInterfaces';
import { getSubscriptionFeedCache } from '@server/job/refreshSubscriptionFeedCache';
import { Permission } from '@server/lib/permissions';
import { getRecentlyAdded } from '@server/lib/recentlyAdded';
import { MoreThan } from 'typeorm';
import { z } from 'zod';

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** 按 tmdbId + 媒体类型查 TMDB 标题（失败返回 null） */
async function fetchMediaTitle(
  tmdbId: number | null | undefined,
  mediaType: string | null | undefined
): Promise<string | null> {
  if (!tmdbId) return null;
  try {
    const tmdb = new TheMovieDb();
    if (mediaType === 'tv') {
      const tv = await tmdb.getTvShow({ tvId: tmdbId });
      return tv.name ?? null;
    }
    if (mediaType === 'movie') {
      const movie = await tmdb.getMovie({ movieId: tmdbId });
      return movie.title ?? null;
    }
  } catch {
    // TMDB 查询失败不阻断请求查询
  }
  return null;
}

/**
 * MCP 工具集（Sinerr 2.0 模块 9）
 *
 * 只读工具：搜索媒体 / 查请求 / 查动态 / 查用户 / 最近添加。
 * 写工具：发起请求 / 更新请求状态 / 删除请求（管理员级）。
 * 令牌鉴权（Bearer 复用「应用程序密钥」apiKey），管理员级访问。
 */

const searchMedia: McpTool = {
  name: 'search_media',
  title: '搜索媒体',
  description: '按关键词搜索影视媒体（电影与剧集）',
  inputSchema: {
    query: z.string().describe('搜索关键词'),
  },
  handler: async (args) => {
    const tmdb = new TheMovieDb();
    const result = await tmdb.searchMulti({
      query: String(args.query),
    });
    return result.results
      .filter((r: { media_type?: string }) => r.media_type !== 'person')
      .slice(0, 10)
      .map(
        (r: {
          id: number;
          media_type?: string;
          title?: string;
          name?: string;
        }) => ({
          tmdbId: r.id,
          mediaType: r.media_type ?? 'unknown',
          title: r.title ?? r.name,
        })
      );
  },
};

const listRequests: McpTool = {
  name: 'list_requests',
  title: '查询请求',
  description: '列出媒体请求（可按状态过滤）',
  inputSchema: {
    filter: z.string().optional().describe('pending/approved/processing 等'),
    take: z.number().optional().describe('数量，默认 20'),
  },
  handler: async (args) => {
    const repo = getRepository(MediaRequest);
    const where: Record<string, unknown> = {};
    const filter = String(args.filter ?? '');
    if (filter === 'pending') where.status = MediaRequestStatus.PENDING;
    else if (filter === 'approved') where.status = MediaRequestStatus.APPROVED;
    const take = Number(args.take ?? 20);
    const requests = await repo.find({
      where,
      relations: { requestedBy: true, media: true },
      order: { createdAt: 'DESC' },
      take,
    });
    return Promise.all(
      requests.map(async (r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        tmdbId: r.media?.tmdbId,
        title: await fetchMediaTitle(r.media?.tmdbId, r.media?.mediaType),
        requestedBy: r.requestedBy?.displayName,
        createdAt: r.createdAt,
      }))
    );
  },
};

const getRequest: McpTool = {
  name: 'get_request',
  title: '查询单个请求',
  description: '按 id 查询单个媒体请求详情',
  inputSchema: {
    id: z.number().describe('请求 id'),
  },
  handler: async (args) => {
    const request = await getRepository(MediaRequest).findOne({
      where: { id: Number(args.id) },
      relations: { requestedBy: true, media: true },
    });
    if (!request) return { found: false };
    return {
      found: true,
      id: request.id,
      type: request.type,
      status: request.status,
      tmdbId: request.media?.tmdbId,
      title: await fetchMediaTitle(
        request.media?.tmdbId,
        request.media?.mediaType
      ),
      mediaType: request.media?.mediaType,
      requestedBy: request.requestedBy?.displayName,
      createdAt: request.createdAt,
    };
  },
};

const listActivity: McpTool = {
  name: 'list_activity',
  title: '读取动态',
  description: '读取最近动态（请求/声援/问题/播放/短评）',
  inputSchema: {
    take: z.number().optional().describe('数量，默认 20'),
  },
  handler: async (args) => {
    const take = Number(args.take ?? 20);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [requests, votes, issues, playbacks, reviews] = await Promise.all([
      getRepository(MediaRequest).find({
        where: { createdAt: MoreThan(since) },
        relations: { requestedBy: true },
        take,
      }),
      getRepository(RequestVote).find({
        relations: { user: true, request: { media: true } },
        take,
      }),
      getRepository(Issue).find({
        relations: { createdBy: true, media: true },
        take,
      }),
      getRepository(PlaybackEvent).find({
        relations: { user: true },
        take,
      }),
      getRepository(MediaReview).find({
        relations: { user: true, media: true },
        take,
      }),
    ]);

    const items: { type: string; user: string; createdAt: Date }[] = [
      ...requests.map((r) => ({
        type: 'request',
        user: r.requestedBy?.displayName ?? '',
        createdAt: r.createdAt,
      })),
      ...votes.map((v) => ({
        type: 'vote',
        user: v.user?.displayName ?? '',
        createdAt: v.createdAt,
      })),
      ...issues.map((i) => ({
        type: 'issue',
        user: i.createdBy?.displayName ?? '',
        createdAt: i.createdAt,
      })),
      ...playbacks.map((p) => ({
        type: 'playback',
        user: p.user?.displayName ?? '',
        createdAt: p.createdAt,
      })),
      ...reviews.map((r) => ({
        type: 'review',
        user: r.user?.displayName ?? '',
        createdAt: r.createdAt,
      })),
    ];
    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  },
};

const listUsers: McpTool = {
  name: 'list_users',
  title: '用户列表',
  description: '列出全部用户',
  inputSchema: {},
  handler: async () => {
    const users = await getRepository(User).find();
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      userType: u.userType,
    }));
  },
};

const getUser: McpTool = {
  name: 'get_user',
  title: '查询用户',
  description: '按 id 查询单个用户',
  inputSchema: {
    id: z.number().describe('用户 id'),
  },
  handler: async (args) => {
    const user = await getRepository(User).findOne({
      where: { id: Number(args.id) },
    });
    if (!user) return { found: false };
    return {
      found: true,
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      userType: user.userType,
    };
  },
};

const listRecentlyAdded: McpTool = {
  name: 'list_recently_added',
  title: '最近添加',
  description: '最近添加的影视与剧集更新',
  inputSchema: {
    take: z.number().optional().describe('数量，默认 10'),
  },
  handler: async (args) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { results } = await getRecentlyAdded(
      since,
      Number(args.take ?? 10),
      0
    );
    return results.map((r) => ({
      tmdbId: r.media.tmdbId,
      mediaType: r.media.mediaType,
      episodeCount: r.episodeCount,
      voteCount: r.voteCount,
    }));
  },
};

/** 解析操作人（缺省管理员 id=1），返回 null 表示用户不存在 */
async function resolveActor(userIdRaw: unknown): Promise<User | null> {
  const userId = Number(userIdRaw ?? 1);
  if (!Number.isInteger(userId)) return null;
  return getRepository(User).findOne({ where: { id: userId } });
}

const requestMedia: McpTool = {
  name: 'request_media',
  title: '发起请求',
  description: '提交影视请求（电影/剧集，可指定季；写操作，需管理员密钥）',
  inputSchema: {
    mediaType: z.enum(['movie', 'tv']).describe('媒体类型'),
    tmdbId: z.number().describe('TMDB id'),
    seasons: z
      .array(z.number())
      .optional()
      .describe('剧集：请求的季号，缺省请求全部季'),
    userId: z.number().optional().describe('提交人用户 id，缺省为管理员'),
  },
  handler: async (args) => {
    const mediaType = String(args.mediaType);
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return { success: false, error: 'mediaType 必须是 movie 或 tv' };
    }
    const actor = await resolveActor(args.userId);
    if (!actor) {
      return { success: false, error: `操作人用户不存在` };
    }

    const body: MediaRequestBody = {
      mediaType: mediaType as MediaType,
      mediaId: Number(args.tmdbId),
      userId: actor.id,
      seasons:
        mediaType === 'tv'
          ? Array.isArray(args.seasons) && args.seasons.length > 0
            ? (args.seasons as number[])
            : 'all'
          : undefined,
    };

    try {
      const request = await MediaRequest.request(body, actor);
      return {
        success: true,
        requestId: request.id,
        status: request.status,
        tmdbId: request.media?.tmdbId,
        mediaType: request.media?.mediaType,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }
  },
};

const updateRequestStatus: McpTool = {
  name: 'update_request_status',
  title: '更新请求状态',
  description: '审批/驳回/转待处理请求（需操作人具备 MANAGE_REQUESTS 权限）',
  inputSchema: {
    requestId: z.number().describe('请求 id'),
    status: z.enum(['approve', 'decline', 'pending']).describe('目标状态'),
    userId: z.number().optional().describe('操作人用户 id，缺省为管理员'),
  },
  handler: async (args) => {
    const statusMap = {
      approve: MediaRequestStatus.APPROVED,
      decline: MediaRequestStatus.DECLINED,
      pending: MediaRequestStatus.PENDING,
    } as const;
    const newStatus = statusMap[String(args.status) as keyof typeof statusMap];
    if (!newStatus) {
      return { success: false, error: 'status 必须是 approve/decline/pending' };
    }
    const actor = await resolveActor(args.userId);
    if (!actor) {
      return { success: false, error: `操作人用户不存在` };
    }
    if (!actor.hasPermission(Permission.MANAGE_REQUESTS)) {
      return { success: false, error: '操作人缺少 MANAGE_REQUESTS 权限' };
    }

    const request = await getRepository(MediaRequest).findOne({
      where: { id: Number(args.requestId) },
      relations: { requestedBy: true, modifiedBy: true },
    });
    if (!request) {
      return { success: false, error: '请求不存在' };
    }
    request.status = newStatus;
    request.modifiedBy = actor;
    await getRepository(MediaRequest).save(request);

    return { success: true, requestId: request.id, status: request.status };
  },
};

const deleteRequest: McpTool = {
  name: 'delete_request',
  title: '删除请求',
  description: '删除媒体请求（管理员，或请求人删除自己的待处理请求）',
  inputSchema: {
    requestId: z.number().describe('请求 id'),
    userId: z.number().optional().describe('操作人用户 id，缺省为管理员'),
  },
  handler: async (args) => {
    const actor = await resolveActor(args.userId);
    if (!actor) {
      return { success: false, error: `操作人用户不存在` };
    }
    const request = await getRepository(MediaRequest).findOne({
      where: { id: Number(args.requestId) },
      relations: { requestedBy: true },
    });
    if (!request) {
      return { success: false, error: '请求不存在' };
    }
    if (
      !actor.hasPermission(Permission.MANAGE_REQUESTS) &&
      request.requestedBy.id !== actor.id
    ) {
      return { success: false, error: '无权限删除该请求' };
    }
    await getRepository(MediaRequest).remove(request);
    return { success: true, requestId: Number(args.requestId) };
  },
};

/** 追剧日历：MoviePilot 订阅中影片未来 7 天的更新（读定时缓存） */
const getSubscriptionFeed: McpTool = {
  name: 'get_subscription_feed',
  title: '追剧日历',
  description:
    '返回订阅中影片未来 7 天的更新（MoviePilot 订阅 + TMDB air_date 定时缓存）',
  inputSchema: {},
  handler: async () => {
    const feed = getSubscriptionFeedCache();
    return feed ?? { generatedAt: 0, entries: [] };
  },
};

/** 已看：按用户聚合本地播放记录（PlaybackEvent） */
const getWatched: McpTool = {
  name: 'get_watched',
  title: '查询已看',
  description: '返回指定用户已看的影片（本地播放记录聚合）',
  inputSchema: {
    userId: z.number().describe('用户 id'),
  },
  handler: async (args) => {
    const userId = Number(args.userId);
    const events = await getRepository(PlaybackEvent)
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.user', 'user')
      .where('user.id = :userId', { userId })
      .orderBy('event.createdAt', 'DESC')
      .getMany();
    const byTmdb = new Map<
      number,
      {
        mediaType: string;
        completed: boolean;
        durationSeconds: number;
        lastWatchedAt: Date;
      }
    >();
    for (const event of events) {
      const existing = byTmdb.get(event.tmdbId);
      if (!existing) {
        byTmdb.set(event.tmdbId, {
          mediaType: event.mediaType,
          completed: event.completed,
          durationSeconds: event.durationSeconds,
          lastWatchedAt: event.createdAt,
        });
      } else {
        existing.completed = existing.completed || event.completed;
        existing.durationSeconds += event.durationSeconds;
      }
    }
    return [...byTmdb.entries()].map(([tmdbId, v]) => ({
      tmdbId,
      mediaType: v.mediaType,
      completed: v.completed,
      durationSeconds: v.durationSeconds,
      lastWatchedAt: v.lastWatchedAt,
    }));
  },
};

/** 年度报告：按年聚合本地播放记录 */
const getReport: McpTool = {
  name: 'get_report',
  title: '年度报告',
  description: '返回指定用户某年的播放统计（总时长/播放次数/看完数等）',
  inputSchema: {
    userId: z.number().describe('用户 id'),
    year: z.number().optional().describe('年份，默认当前年'),
  },
  handler: async (args) => {
    const userId = Number(args.userId);
    const year = Number(args.year ?? new Date().getFullYear());
    const since = new Date(year, 0, 1);
    const until = new Date(year + 1, 0, 1);
    const events = await getRepository(PlaybackEvent)
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.user', 'user')
      .where('user.id = :userId', { userId })
      .andWhere('event.createdAt >= :since', { since })
      .andWhere('event.createdAt < :until', { until })
      .getMany();
    const totalSeconds = events.reduce((sum, e) => sum + e.durationSeconds, 0);
    const uniqueTitles = new Set(events.map((e) => e.tmdbId));
    const completed = new Set(
      events.filter((e) => e.completed).map((e) => e.tmdbId)
    );
    return {
      year,
      totalSeconds,
      playCount: events.length,
      watchedTitles: uniqueTitles.size,
      completedTitles: completed.size,
    };
  },
};

export const mcpTools: McpTool[] = [
  searchMedia,
  listRequests,
  getRequest,
  getSubscriptionFeed,
  getWatched,
  getReport,
  listActivity,
  listUsers,
  getUser,
  listRecentlyAdded,
  requestMedia,
  updateRequestStatus,
  deleteRequest,
];

/**
 * 创建并配置 MCP Server（动态 import 以兼容 CommonJS 运行时）
 */
/** 动态 import 下只依赖的最小接口（协议由 SDK 保证） */
interface MinimalMcpServer {
  registerTool: (
    name: string,
    config: Record<string, unknown>,
    cb: (args: Record<string, unknown>) => Promise<unknown>
  ) => void;
}

export async function createMcpServer(): Promise<unknown> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({
    name: 'Sinerr',
    version: '2.0.0',
  }) as unknown as MinimalMcpServer;

  for (const tool of mcpTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await tool.handler(args ?? {})),
            },
          ],
        };
      }
    );
  }

  return server;
}
