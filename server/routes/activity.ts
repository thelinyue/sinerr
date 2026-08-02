import type { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Issue from '@server/entity/Issue';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import type {
  ActivityItem,
  ActivityResponse,
} from '@server/interfaces/api/activityInterfaces';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
const activityRoutes = Router();

/**
 * 拉取某一类动作的最新记录，并统一为 ActivityItem 结构
 */
async function collectRequests(take: number): Promise<ActivityItem[]> {
  const requestRepository = getRepository(MediaRequest);
  const requests = await requestRepository
    .createQueryBuilder('request')
    .leftJoinAndSelect('request.requestedBy', 'requestedBy')
    .leftJoinAndSelect('request.media', 'media')
    .orderBy('request.createdAt', 'DESC')
    .take(take)
    .getMany();

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

async function collectVotes(take: number): Promise<ActivityItem[]> {
  const requestVoteRepository = getRepository(RequestVote);
  const votes = await requestVoteRepository
    .createQueryBuilder('vote')
    .leftJoinAndSelect('vote.user', 'user')
    .leftJoinAndSelect('vote.request', 'request')
    .leftJoinAndSelect('request.media', 'media')
    .orderBy('vote.createdAt', 'DESC')
    .take(take)
    .getMany();

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

async function collectIssues(take: number): Promise<ActivityItem[]> {
  const issueRepository = getRepository(Issue);
  const issues = await issueRepository
    .createQueryBuilder('issue')
    .leftJoinAndSelect('issue.createdBy', 'createdBy')
    .leftJoinAndSelect('issue.media', 'media')
    .orderBy('issue.createdAt', 'DESC')
    .take(take)
    .getMany();

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

activityRoutes.get<Record<string, string>, ActivityResponse>(
  '/',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const pageSize = req.query.take ? Number(req.query.take) : 20;
      const skip = req.query.skip ? Number(req.query.skip) : 0;

      const [requests, votes, issues] = await Promise.all([
        collectRequests(pageSize + skip),
        collectVotes(pageSize + skip),
        collectIssues(pageSize + skip),
      ]);

      // 按时间归并排序后截取当前页
      const merged = [...requests, ...votes, ...issues].sort(
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

export default activityRoutes;
