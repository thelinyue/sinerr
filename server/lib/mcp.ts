import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
import { getRecentlyAdded } from '@server/lib/recentlyAdded';

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * MCP 工具集（Sinerr 2.0 模块 9）
 *
 * 只读工具：搜索媒体 / 查请求 / 查动态 / 查用户 / 最近添加。
 * 令牌鉴权（Bearer 复用「应用程序密钥」apiKey），管理员级访问。
 */

const searchMedia: McpTool = {
  name: 'search_media',
  title: '搜索媒体',
  description: '按关键词搜索影视媒体（电影与剧集）',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: '搜索关键词' } },
    required: ['query'],
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
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'pending/approved/processing 等' },
      take: { type: 'number', description: '数量，默认 20' },
    },
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
    return requests.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      tmdbId: r.media?.tmdbId,
      requestedBy: r.requestedBy?.displayName,
      createdAt: r.createdAt,
    }));
  },
};

const getRequest: McpTool = {
  name: 'get_request',
  title: '查询单个请求',
  description: '按 id 查询单个媒体请求详情',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'number', description: '请求 id' } },
    required: ['id'],
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
    type: 'object',
    properties: { take: { type: 'number', description: '数量，默认 20' } },
  },
  handler: async (args) => {
    const take = Number(args.take ?? 20);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [requests, votes, issues, playbacks, reviews] = await Promise.all([
      getRepository(MediaRequest).find({
        where: { createdAt: { $gt: since } as never },
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
  inputSchema: { type: 'object', properties: {} },
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
    type: 'object',
    properties: { id: { type: 'number', description: '用户 id' } },
    required: ['id'],
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
    type: 'object',
    properties: { take: { type: 'number', description: '数量，默认 10' } },
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

export const mcpTools: McpTool[] = [
  searchMedia,
  listRequests,
  getRequest,
  listActivity,
  listUsers,
  getUser,
  listRecentlyAdded,
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
