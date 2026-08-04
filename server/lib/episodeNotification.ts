import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import type { User } from '@server/entity/User';
import notificationManager, { Notification } from '@server/lib/notifications';
import logger from '@server/logger';

/**
 * 追更通知（Sinerr 2.0 模块 4-F1）
 *
 * 扫描批量 upsert 检测到新增单集后，通知该剧的请求人 + 声援人（去重）。
 * 防轰炸：同剧每日上限 1 条（内存 Map，服务重启后重置，可接受）。
 * 不走 subscriber：批量 orIgnore 插入不触发 @AfterInsert（决策 34）。
 */

const lastNotifiedAt = new Map<number, number>();
const DAILY_LIMIT_MS = 24 * 60 * 60 * 1000;

/** 测试用：清空防轰炸状态 */
export const resetEpisodeNotificationState = (): void => {
  lastNotifiedAt.clear();
};

interface EpisodeUpdatedParams {
  mediaId: number;
  tmdbId: number;
  mediaType: MediaType;
  newEpisodes: { seasonNumber: number; episodeNumber: number; addedAt: Date }[];
}

/** 最新更新点：季最大优先，其次集最大 */
function latestPoint(
  newEpisodes: { seasonNumber: number; episodeNumber: number }[]
): { season: number; episode: number } | null {
  let best: { season: number; episode: number } | null = null;
  for (const ep of newEpisodes) {
    if (
      !best ||
      ep.seasonNumber > best.season ||
      (ep.seasonNumber === best.season && ep.episodeNumber > best.episode)
    ) {
      best = { season: ep.seasonNumber, episode: ep.episodeNumber };
    }
  }
  return best;
}

/** 默认标题获取：TMDB */
async function defaultGetTitle(
  tmdbId: number,
  mediaType: MediaType
): Promise<{ title: string; image: string }> {
  const tmdb = new TheMovieDb();
  if (mediaType === MediaType.MOVIE) {
    const movie = await tmdb.getMovie({ movieId: tmdbId });
    return {
      title: movie.title,
      image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
    };
  }
  const tv = await tmdb.getTvShow({ tvId: tmdbId });
  return {
    title: tv.name,
    image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
  };
}

export async function notifyEpisodeUpdated(
  params: EpisodeUpdatedParams,
  opts?: {
    /** 可注入标题获取（测试用）；默认走 TMDB */
    getTitle?: (
      tmdbId: number,
      mediaType: MediaType
    ) => Promise<{ title: string; image: string }>;
  }
): Promise<void> {
  // 防轰炸：同剧每日 1 条
  const now = Date.now();
  if (now - (lastNotifiedAt.get(params.mediaId) ?? 0) < DAILY_LIMIT_MS) {
    return;
  }
  lastNotifiedAt.set(params.mediaId, now);

  try {
    // 请求人 + 声援人（去重）
    const requestRepo = getRepository(MediaRequest);
    const voteRepo = getRepository(RequestVote);
    const [requests, votes, media] = await Promise.all([
      requestRepo.find({
        where: { media: { id: params.mediaId } },
        relations: { requestedBy: true },
      }),
      voteRepo.find({
        where: { request: { media: { id: params.mediaId } } },
        relations: { user: true },
      }),
      getRepository(Media).findOne({ where: { id: params.mediaId } }),
    ]);

    const userSet = new Map<number, User>();
    for (const request of requests) {
      if (request.status !== MediaRequestStatus.DECLINED) {
        userSet.set(request.requestedBy.id, request.requestedBy);
      }
    }
    for (const vote of votes) {
      if (vote.user) {
        userSet.set(vote.user.id, vote.user);
      }
    }

    if (userSet.size === 0 || !media) {
      return;
    }

    const getTitle = opts?.getTitle ?? defaultGetTitle;
    const { title, image } = await getTitle(media.tmdbId, media.mediaType);

    const point = latestPoint(params.newEpisodes);
    const message = point
      ? `已更新至 第${point.season}季 第${point.episode}集`
      : '更新了新集';

    for (const user of userSet.values()) {
      notificationManager.sendNotification(Notification.EPISODE_UPDATED, {
        event: 'Episode Updated',
        subject: title,
        message,
        media,
        image,
        notifyAdmin: false,
        notifySystem: true,
        notifyUser: user,
      });
    }
  } catch (e) {
    logger.error(
      'Something went wrong sending episode update notification(s)',
      {
        label: 'Notifications',
        mediaId: params.mediaId,
        errorMessage: e.message,
      }
    );
  }
}
