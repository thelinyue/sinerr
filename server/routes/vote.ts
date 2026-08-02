import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
import type {
  RequestVoteResponse,
  RequestVotesResponse,
} from '@server/interfaces/api/voteInterfaces';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';

const voteRoutes = Router();

/**
 * 解析点赞聚合信息（数量 + 当前用户是否已点赞）
 *
 * 统一由这里显式查询，避免依赖 TypeORM 关系加载的行为差异。
 */
async function getVoteState(
  request: MediaRequest,
  userId: number
): Promise<RequestVoteResponse> {
  const requestVoteRepository = getRepository(RequestVote);

  const voteCount = await requestVoteRepository.count({
    where: { request: { id: request.id } },
  });
  const userVoted =
    (await requestVoteRepository.count({
      where: { request: { id: request.id }, user: { id: userId } },
    })) > 0;

  return { voteCount, userVoted };
}

/**
 * 获取点赞用户列表
 *
 * 可见范围：请求人本人或拥有 REQUEST_VIEW / MANAGE_REQUESTS 权限的用户
 * 可以看到完整的点赞用户信息，其余登录用户仅能获取数量与「是否已点赞」。
 */
async function getVoters(
  request: MediaRequest,
  viewer: User | undefined
): Promise<{ results: Partial<User>[]; voteCount: number }> {
  const requestVoteRepository = getRepository(RequestVote);

  const votes = await requestVoteRepository
    .createQueryBuilder('vote')
    .leftJoinAndSelect('vote.user', 'user')
    .where('vote.requestId = :requestId', { requestId: request.id })
    .orderBy('vote.createdAt', 'DESC')
    .getMany();

  const canViewVoters =
    viewer &&
    (request.requestedBy.id === viewer.id ||
      viewer.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      ));

  return {
    results: canViewVoters
      ? User.filterMany(votes.map((vote) => vote.user))
      : [],
    voteCount: votes.length,
  };
}

voteRoutes.post<{ requestId: string }, RequestVoteResponse>(
  '/:requestId/vote',
  isAuthenticated(Permission.VOTE),
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to vote on a request.',
        });
      }

      const requestRepository = getRepository(MediaRequest);
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      // 不允许给自己的请求点赞
      if (request.requestedBy.id === req.user.id) {
        return next({
          status: 400,
          message: 'You cannot vote on your own request.',
        });
      }

      const requestVoteRepository = getRepository(RequestVote);

      // 幂等：已点赞则直接返回当前状态
      const existing = await requestVoteRepository.findOne({
        where: {
          request: { id: request.id },
          user: { id: req.user.id },
        },
      });

      if (existing) {
        return res.status(200).json(await getVoteState(request, req.user.id));
      }

      const vote = new RequestVote({ request, user: req.user });

      try {
        await requestVoteRepository.save(vote);
      } catch (e) {
        // 并发重复点赞由唯一索引兜底，视为已点赞
        if (e instanceof QueryFailedError) {
          return res.status(200).json(await getVoteState(request, req.user.id));
        }
        throw e;
      }

      return res.status(201).json(await getVoteState(request, req.user.id));
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Request not found.' });
      }
      logger.error('Something went wrong voting on a request.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

voteRoutes.delete<{ requestId: string }, RequestVoteResponse>(
  '/:requestId/vote',
  isAuthenticated(Permission.VOTE),
  async (req, res, next) => {
    try {
      if (!req.user) {
        return next({
          status: 401,
          message: 'You must be logged in to vote on a request.',
        });
      }

      const requestRepository = getRepository(MediaRequest);
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      const requestVoteRepository = getRepository(RequestVote);
      const existing = await requestVoteRepository.findOne({
        where: {
          request: { id: request.id },
          user: { id: req.user.id },
        },
      });

      // 幂等：未点赞则直接返回当前状态
      if (existing) {
        await requestVoteRepository.remove(existing);
      }

      return res.status(200).json(await getVoteState(request, req.user.id));
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Request not found.' });
      }
      logger.error('Something went wrong removing a vote.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

voteRoutes.get<{ requestId: string }, RequestVotesResponse>(
  '/:requestId/votes',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const requestRepository = getRepository(MediaRequest);
      const request = await requestRepository.findOneOrFail({
        where: { id: Number(req.params.requestId) },
        relations: { requestedBy: true, modifiedBy: true },
      });

      if (
        request.requestedBy.id !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view votes on this request.',
        });
      }

      const result = await getVoters(request, req.user);

      return res.status(200).json({
        ...result,
        ...(await getVoteState(request, req.user?.id ?? 0)),
      });
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Request not found.' });
      }
      logger.error('Something went wrong retrieving votes.', {
        label: 'API',
        errorMessage: e.message,
      });
      next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

export default voteRoutes;
