import type { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
import type {
  ActivityItem,
  ActivityResponse,
  ActivityType,
} from '@server/interfaces/api/activityInterfaces';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { In, MoreThan } from 'typeorm';

const activityRoutes = Router();

/**
 * 拉取某一类动作的最新记录，并统一为 ActivityItem 结构
 */
async function collectRequests(
  take: number,
  userId?: number
): Promise<ActivityItem[]> {
  const requestRepository = getRepository(MediaRequest);
  let query = requestRepository
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .leftJoinAndSelect('request.media', 'media')
    .orderBy('request.createdAt', 'DESC')
    .take(take);

  if (userId) {
    query = query.andWhere('requestedBy.id = :userId', { userId });
  }

  const requests = await query.getMany();

  return requests.map((request) => ({
    id: request.id,
    type: 'request' as const,
    createdAt: request.createdAt,
    actor: {
      id: request.requestedBy.id,
      displayName: request.requestedBy.displayName,
      avatar: request.requestedBy.avatar,
    },
    payload: {
      tmdbId: request.media.tmdbId,
      mediaType: request.media.mediaType as MediaType,
      requestId: request.id,
    },
  }));
}

async function collectVotes(
  take: number,
  userId?: number
): Promise<ActivityItem[]> {
  const requestVoteRepository = getRepository(RequestVote);
  let query = requestVoteRepository
    .createQueryBuilder('vote')
    .leftJoinAndSelect('vote.user', 'user')
    .leftJoinAndSelect('vote.request', 'request')
    .leftJoinAndSelect('request.media', 'media')
    .orderBy('vote.createdAt', 'DESC')
    .take(take);

  if (userId) {
    query = query.andWhere('user.id = :userId', { userId });
  }

  const votes = await query.getMany();

  return votes.map((vote) => ({
    id: vote.id,
    type: 'vote' as const,
    createdAt: vote.createdAt,
    actor: {
      id: vote.user.id,
      displayName: vote.user.displayName,
      avatar: vote.user.avatar,
    },
    payload: {
      tmdbId: vote.request.media.tmdbId,
      mediaType: vote.request.media.mediaType as MediaType,
      requestId: vote.request.id,
    },
  }));
}

async function collectIssues(
  take: number,
  userId?: number
): Promise<ActivityItem[]> {
  const issueRepository = getRepository(Issue);
  let query = issueRepository
    .createQueryBuilder('issue')
    .leftJoinAndSelect('issue.createdBy', 'createdBy')
    .leftJoinAndSelect('issue.media', 'media')
    .orderBy('issue.createdAt', 'DESC')
    .take(take);

  if (userId) {
    query = query.andWhere('createdBy.id = :userId', { userId });
  }

  const issues = await query.getMany();

  return issues.map((issue) => ({
    id: issue.id,
    type: 'issue' as const,
    createdAt: issue.createdAt,
    actor: {
      id: issue.createdBy.id,
      displayName: issue.createdBy.displayName,
      avatar: issue.createdBy.avatar,
    },
    payload: {
      tmdbId: issue.media.tmdbId,
      mediaType: issue.media.mediaType as MediaType,
      issueId: issue.id,
    },
  }));
}

/**
 * 媒体短评聚合
 *
 * 与请求/声援/Issue 一致：按 createdAt 倒序拉取，输出评分与短评内容。
 * 可见性：短评发表需 REQUEST 权限，属于「表达意向」类社交行为，默认登录可见。
 */
async function collectReviews(
  take: number,
  userId?: number
): Promise<ActivityItem[]> {
  const reviewRepository = getRepository(MediaReview);
  let query = reviewRepository
    .createQueryBuilder('review')
    .leftJoinAndSelect('review.user', 'user')
    .leftJoinAndSelect('review.media', 'media')
    .orderBy('review.createdAt', 'DESC')
    .take(take);

  if (userId) {
    query = query.andWhere('user.id = :userId', { userId });
  }

  const reviews = await query.getMany();

  return reviews.map((review) => ({
    id: review.id,
    type: 'review' as const,
    createdAt: review.createdAt,
    actor: {
      id: review.user.id,
      displayName: review.user.displayName,
      avatar: review.user.avatar,
    },
    payload: {
      tmdbId: review.media.tmdbId,
      mediaType: review.media.mediaType as MediaType,
      rating: review.rating,
      message: review.message,
      seasonNumber: review.seasonNumber,
      episodeNumber: review.episodeNumber,
    },
  }));
}

/**
 * 播放记录聚合
 *
 * 可见性规则（隐私）：
 * - 播放记录属于「默认全站可见」，但用户可以关闭（settings.playbackVisible = false）
 * - 管理员（MANAGE_USERS）始终可见所有播放记录
 * - 本人始终可见自己的播放记录
 * - 通过 userId 过滤时，仅当请求者是目标用户本人或管理员时返回播放记录
 */
async function collectPlayback(
  take: number,
  viewer: User | undefined,
  userId?: number
): Promise<ActivityItem[]> {
  const playbackRepository = getRepository(PlaybackEvent);

  let query = playbackRepository
    .createQueryBuilder('event')
    .leftJoinAndSelect('event.user', 'user')
    .orderBy('event.createdAt', 'DESC')
    .take(take);

  // 播放记录可见性过滤：
  // 1. 未指定 userId：默认全站可见，但排除已关闭 playbackVisible 的用户；
  //    管理员查看时不过滤
  // 2. 指定 userId：仅本人或管理员可查看该用户的播放记录
  const isAdmin = viewer?.hasPermission(Permission.MANAGE_USERS);

  if (userId) {
    // 仅本人或管理员可查指定用户的播放记录
    if (!isAdmin && viewer?.id !== userId) {
      return [];
    }
    query = query.andWhere('user.id = :userId', { userId });
  } else if (!isAdmin) {
    // 非管理员：排除关闭播放可见性的用户
    const hiddenUserIds = (
      await getRepository(User).find({
        where: { settings: { playbackVisible: false } },
        select: ['id'],
      })
    ).map((u) => u.id);
    if (hiddenUserIds.length > 0) {
      query = query.andWhere('user.id NOT IN (:...hiddenUserIds)', {
        hiddenUserIds,
      });
    }
  }

  const events = await query.getMany();

  return events.map((event) => ({
    id: event.id,
    type: 'playback' as const,
    createdAt: event.createdAt,
    actor: {
      id: event.user.id,
      displayName: event.user.displayName,
      avatar: event.user.avatar,
    },
    payload: {
      tmdbId: event.tmdbId,
      mediaType: event.mediaType as MediaType,
      completed: event.completed,
      durationSeconds: event.durationSeconds,
      seasonNumber: event.seasonNumber,
      episodeNumber: event.episodeNumber,
    },
  }));
}

activityRoutes.get<Record<string, string>, ActivityResponse>(
  '/',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const pageSize = req.query.take ? Number(req.query.take) : 20;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const typeFilter = (req.query.type as ActivityType | undefined) ?? 'all';
      const userId = req.query.userId ? Number(req.query.userId) : undefined;

      const collectors: {
        type: ActivityType;
        run: () => Promise<ActivityItem[]>;
      }[] = [];

      if (typeFilter === 'all' || typeFilter === 'request') {
        collectors.push({
          type: 'request',
          run: () => collectRequests(pageSize + skip, userId),
        });
      }
      if (typeFilter === 'all' || typeFilter === 'vote') {
        collectors.push({
          type: 'vote',
          run: () => collectVotes(pageSize + skip, userId),
        });
      }
      if (typeFilter === 'all' || typeFilter === 'issue') {
        collectors.push({
          type: 'issue',
          run: () => collectIssues(pageSize + skip, userId),
        });
      }
      if (typeFilter === 'all' || typeFilter === 'playback') {
        collectors.push({
          type: 'playback',
          run: () => collectPlayback(pageSize + skip, req.user, userId),
        });
      }
      if (typeFilter === 'all' || typeFilter === 'review') {
        collectors.push({
          type: 'review',
          run: () => collectReviews(pageSize + skip, userId),
        });
      }

      const results = await Promise.all(collectors.map((c) => c.run()));

      // 按时间归并排序后截取当前页
      const merged = results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      return res.status(200).json({
        results: merged.slice(skip, skip + pageSize),
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

/**
 * 未读动态计数（模块 1）
 *
 * 无状态固定窗口：前端传 since（localStorage activity-last-seen），
 * 返回五表 createdAt > since 的计数之和。服务端不存 lastSeen。
 */
activityRoutes.get('/count', isAuthenticated(), async (req, res, next) => {
  try {
    const since = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [requests, votes, issues, playbacks, reviews] = await Promise.all([
      getRepository(MediaRequest).count({
        where: { createdAt: MoreThan(since) },
      }),
      getRepository(RequestVote).count({
        where: { createdAt: MoreThan(since) },
      }),
      getRepository(Issue).count({
        where: { createdAt: MoreThan(since) },
      }),
      getRepository(PlaybackEvent).count({
        where: { createdAt: MoreThan(since) },
      }),
      getRepository(MediaReview).count({
        where: { createdAt: MoreThan(since) },
      }),
    ]);

    return res
      .status(200)
      .json({ count: requests + votes + issues + playbacks + reviews });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

/**
 * 本周剧集/电影观看排行（媒体维度）
 *
 * 统计近 `days`（默认 7）天内 PlaybackEvent，按 tmdbId+mediaType 聚合：
 * - watchCount：观看次数（记录条数，同一用户重复观看会累计）
 * - watchers：观看人数（distinct 用户）
 * - durationSeconds：累计净观看时长
 *
 * 隐私：只统计 playbackVisible 公开用户的记录（与动态播放记录一致）。
 * 排序：优先 watchers，其次 watchCount。
 */
activityRoutes.get('/watched', isAuthenticated(), async (req, res, next) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const take = req.query.take ? Number(req.query.take) : 10;
    const mediaType =
      req.query.mediaType === 'movie' || req.query.mediaType === 'tv'
        ? req.query.mediaType
        : undefined;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const qb = getRepository(PlaybackEvent)
      .createQueryBuilder('event')
      .innerJoin('event.user', 'user')
      .where('event.createdAt >= :since', { since })
      .select('event.tmdbId', 'tmdbId')
      .addSelect('event.mediaType', 'mediaType')
      .addSelect('COUNT(*)', 'watchCount')
      .addSelect('COUNT(DISTINCT event.userId)', 'watchers')
      .addSelect('SUM(event.durationSeconds)', 'durationSeconds')
      .groupBy('event.tmdbId')
      .addGroupBy('event.mediaType');

    if (mediaType) {
      qb.andWhere('event.mediaType = :mediaType', { mediaType });
    }

    // 隐私：非管理员只统计 playbackVisible 公开用户的记录（与动态播放记录一致）
    if (!req.user?.hasPermission(Permission.MANAGE_USERS)) {
      qb.innerJoin('user.settings', 'userSettings').andWhere(
        '(userSettings.playbackVisible IS NULL OR userSettings.playbackVisible = :visible)',
        { visible: true }
      );
    }

    // 不在 SQL 里 ORDER BY 别名：PostgreSQL 对未加引号的别名会折叠成小写，
    // 与 SELECT 的驼峰别名不匹配而报错（SQLite 大小写不敏感故本地未暴露）。
    // 改为取回后按 观看人数/次数 在 JS 中排序，跨库行为一致。
    const rows = (await qb.getRawMany()).sort(
      (a, b) =>
        Number(b.watchers) - Number(a.watchers) ||
        Number(b.watchCount) - Number(a.watchCount)
    );
    const topRows = rows.slice(0, take);

    // 每个媒体的观看者（distinct 用户）：id / displayName / avatar，供头像簇展示
    const tmdbIds = topRows.map((row) => Number(row.tmdbId));
    let usersByTmdb = new Map<
      number,
      { id: number; displayName: string; avatar: string }[]
    >();
    if (tmdbIds.length > 0) {
      const distinctRows = await getRepository(PlaybackEvent)
        .createQueryBuilder('event')
        .innerJoin('event.user', 'user')
        .where('event.createdAt >= :since', { since })
        .andWhere('event.tmdbId IN (:...tmdbIds)', { tmdbIds })
        .select('event.tmdbId', 'tmdbId')
        .addSelect('event.userId', 'userId')
        .groupBy('event.tmdbId')
        .addGroupBy('event.userId')
        .getRawMany();

      const userIds = [...new Set(distinctRows.map((r) => Number(r.userId)))];
      const users = userIds.length
        ? await getRepository(User).find({ where: { id: In(userIds) } })
        : [];
      const userById = new Map(users.map((u) => [u.id, u]));

      usersByTmdb = new Map();
      for (const row of distinctRows) {
        const tmdbId = Number(row.tmdbId);
        const u = userById.get(Number(row.userId));
        if (!u) continue;
        const list = usersByTmdb.get(tmdbId) ?? [];
        if (list.length >= 6) continue; // 头像簇最多展示 6 个
        list.push({
          id: u.id,
          displayName: u.displayName || u.username || u.jellyfinUsername || '',
          avatar: u.avatar,
        });
        usersByTmdb.set(tmdbId, list);
      }
    }

    return res.status(200).json({
      results: topRows.map((row) => {
        const tmdbId = Number(row.tmdbId);
        return {
          tmdbId,
          mediaType: row.mediaType,
          watchCount: Number(row.watchCount),
          watchers: Number(row.watchers),
          durationSeconds: Number(row.durationSeconds ?? 0),
          users: usersByTmdb.get(tmdbId) ?? [],
        };
      }),
    });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

export default activityRoutes;
