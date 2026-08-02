import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import notificationManager, { Notification } from '@server/lib/notifications';
import logger from '@server/logger';
import type { EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { EventSubscriber } from 'typeorm';

/**
 * 请求声援（点赞）事件订阅器
 *
 * 在点赞创建后向被点赞的请求人发送 REQUEST_VOTED 通知，
 * 让请求者感知到「有人也想看这部」的社交反馈。
 */
@EventSubscriber()
export class RequestVoteSubscriber implements EntitySubscriberInterface<RequestVote> {
  public listenTo(): typeof RequestVote {
    return RequestVote;
  }

  private async sendVoteNotification(entity: RequestVote): Promise<void> {
    // 重新加载请求及其媒体信息，确保 AfterInsert 阶段数据完整
    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: entity.request?.id },
      relations: { requestedBy: true, modifiedBy: true },
    });

    if (!request) {
      logger.warn('Request not found when sending vote notification.', {
        label: 'Notifications',
      });
      return;
    }

    const tmdb = new TheMovieDb();

    try {
      let title: string;
      let image: string;

      if (request.media.mediaType === MediaType.MOVIE) {
        const movie = await tmdb.getMovie({ movieId: request.media.tmdbId });
        title = `${movie.title}${
          movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`;
      } else {
        const tvshow = await tmdb.getTvShow({ tvId: request.media.tmdbId });
        title = `${tvshow.name}${
          tvshow.first_air_date ? ` (${tvshow.first_air_date.slice(0, 4)})` : ''
        }`;
        image = `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tvshow.poster_path}`;
      }

      notificationManager.sendNotification(Notification.REQUEST_VOTED, {
        event: 'Request Voted',
        subject: title,
        media: request.media,
        request,
        image,
        notifyAdmin: false,
        notifySystem: true,
        // 仅通知被点赞的请求人本人
        notifyUser: request.requestedBy,
        votedBy: entity.user,
      });
    } catch (e) {
      logger.error('Something went wrong sending vote notification(s)', {
        label: 'Notifications',
        errorMessage: e.message,
      });
    }
  }

  public afterInsert(event: InsertEvent<RequestVote>): void {
    if (!event.entity) {
      return;
    }

    this.sendVoteNotification(event.entity);
  }
}
