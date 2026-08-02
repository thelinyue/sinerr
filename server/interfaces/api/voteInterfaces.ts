import type { User } from '@server/entity/User';

/**
 * 请求声援（点赞）相关接口类型
 */
export interface RequestVoteResponse {
  /** 点赞总数 */
  voteCount: number;
  /** 当前登录用户是否已点赞 */
  userVoted: boolean;
}

/**
 * 点赞用户列表响应
 *
 * 出于隐私考虑，仅向请求人本人与拥有 REQUEST_VIEW 权限的用户返回
 * 完整的点赞用户信息（见路由中的鉴权逻辑）。
 */
export interface RequestVotesResponse {
  results: Partial<User>[];
  voteCount: number;
}
