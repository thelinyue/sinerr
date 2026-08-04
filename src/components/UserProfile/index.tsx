import CachedImage from '@app/components/Common/CachedImage';
import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProgressCircle from '@app/components/Common/ProgressCircle';
import RequestCard from '@app/components/RequestCard';
import Slider from '@app/components/Slider';
import Achievements from '@app/components/UserProfile/Achievements';
import ProfileHeader from '@app/components/UserProfile/ProfileHeader';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { ArrowRightCircleIcon } from '@heroicons/react/24/outline';
import type {
  QuotaResponse,
  RecentlyWatchedItem,
  UserRequestsResponse,
  UserWatchTimeResponse,
} from '@server/interfaces/api/userInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile', {
  recentrequests: 'Recent Requests',
  limit: '{remaining} of {limit}',
  requestsperdays: '{limit} remaining',
  unlimited: 'Unlimited',
  totalrequests: 'Total Requests',
  pastdays: '{type} (past {days} days)',
  movierequests: 'Movie Requests',
  seriesrequest: 'Series Requests',
  watchtimeToday: 'Watched Today',
  watchtimeTotal: 'Total Watch Time',
  recentlyWatched: 'Recently Watched',
  noRecentlyWatched: 'No playback records yet.',
  followingTitle: '追更中',
  followingUpdatedTo: '已更新至 第{season}季 第{episode}集',
  followingFinished: '已完结 · 全{seasons}季 · {episodes}集',
});

type MediaTitle = MovieDetails | TvDetails;

/** 把秒数格式化为小时（保留一位小数），不足 0.1 小时显示为 0.1h */
const formatDuration = (totalSeconds: number): string => {
  const hours = Math.round((totalSeconds / 3600) * 10) / 10;
  if (hours < 0.1) {
    return '0.1h';
  }
  const display = hours % 1 === 0 ? Math.round(hours) : hours;
  return `${display}h`;
};

/** 最近观看单条海报卡片：懒加载媒体详情拿海报与标题 */
const RecentlyWatchedCard = ({ item }: { item: RecentlyWatchedItem }) => {
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(url);
  const href =
    item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
  const isMovie = (m: MovieDetails | TvDetails): m is MovieDetails =>
    (m as MovieDetails).title !== undefined;
  const title = data ? (isMovie(data) ? data.title : data.name) : null;

  return (
    <Link href={href} className="w-28 flex-shrink-0 sm:w-32">
      <div className="relative">
        <CachedImage
          type="tmdb"
          src={
            data?.posterPath
              ? `https://image.tmdb.org/t/p/w342${data.posterPath}`
              : '/images/sinerr_poster_not_found.png'
          }
          alt=""
          className="h-40 w-28 rounded-lg object-cover sm:h-48 sm:w-32"
          width={128}
          height={192}
        />
        {item.completed && (
          <span className="absolute right-1 top-1 rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            ✓
          </span>
        )}
        {item.mediaType === 'tv' && item.episodeNumber != null && (
          <span className="absolute bottom-1 left-1 rounded bg-gray-900/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-200">
            {item.seasonNumber != null
              ? `S${item.seasonNumber}E${item.episodeNumber}`
              : `E${item.episodeNumber}`}
          </span>
        )}
      </div>
      <div className="mt-1 line-clamp-1 text-xs text-gray-300">{title}</div>
    </Link>
  );
};

/** 追更中单条：懒加载标题 + 更新状态行（已更新至 / 已完结） */
const FollowingUpdateRow = ({
  item,
}: {
  item: {
    media: { id: number; tmdbId: number; mediaType: 'movie' | 'tv' };
    episodeCount: number;
    newEpisodes: {
      seasonNumber: number;
      episodeNumber: number;
      addedAt: string;
    }[];
  };
}) => {
  const intl = useIntl();
  const url =
    item.media.mediaType === 'movie'
      ? `/api/v1/movie/${item.media.tmdbId}`
      : `/api/v1/tv/${item.media.tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(url);
  const href =
    item.media.mediaType === 'movie'
      ? `/movie/${item.media.tmdbId}`
      : `/tv/${item.media.tmdbId}`;
  const isMovie = (m: MovieDetails | TvDetails): m is MovieDetails =>
    (m as MovieDetails).title !== undefined;
  const title = data ? (isMovie(data) ? data.title : data.name) : null;

  const latest = item.newEpisodes.reduce(
    (best, ep) =>
      !best ||
      ep.seasonNumber > best.seasonNumber ||
      (ep.seasonNumber === best.seasonNumber &&
        ep.episodeNumber > best.episodeNumber)
        ? ep
        : best,
    null as { seasonNumber: number; episodeNumber: number } | null
  );
  const isEnded =
    item.media.mediaType === 'tv' &&
    !!data &&
    !isMovie(data) &&
    (data.status === 'Ended' || data.status === 'Canceled');

  let state: React.ReactNode = null;
  if (item.media.mediaType === 'tv' && data && !isMovie(data) && isEnded) {
    state = (
      <span className="text-xs text-gray-300">
        {intl.formatMessage(messages.followingFinished, {
          seasons: data.numberOfSeasons,
          episodes: data.numberOfEpisodes,
        })}
      </span>
    );
  } else if (latest) {
    state = (
      <span className="text-xs text-emerald-300">
        {intl.formatMessage(messages.followingUpdatedTo, {
          season: latest.seasonNumber,
          episode: latest.episodeNumber,
        })}
        {item.episodeCount > 0 && (
          <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px]">
            ＋{item.episodeCount} 集
          </span>
        )}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/60 p-3 transition hover:bg-gray-700/50"
    >
      <CachedImage
        type="tmdb"
        src={
          data?.posterPath
            ? `https://image.tmdb.org/t/p/w154${data.posterPath}`
            : '/images/sinerr_poster_not_found.png'
        }
        alt=""
        className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
        width={64}
        height={96}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">
          {title ?? '\u00A0'}
        </div>
        <div className="mt-0.5">{state}</div>
      </div>
    </Link>
  );
};

const UserProfile = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, error } = useUser({
    id: Number(router.query.userId),
  });
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const [availableTitles, setAvailableTitles] = useState<
    Record<number, MediaTitle>
  >({});

  const { data: requests, error: requestError } = useSWR<UserRequestsResponse>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user?.id}/requests?take=10&skip=0`
      : null
  );
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'and' }
        ))
      ? `/api/v1/user/${user.id}/quota`
      : null
  );
  const { data: watchTime } = useSWR<UserWatchTimeResponse>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user.id}/watchtime`
      : null
  );

  const { data: recentlyWatched } = useSWR<{ results: RecentlyWatchedItem[] }>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user.id}/recently-watched`
      : null
  );

  // 追更中（模块 4-F2）：本人 + REQUEST_VIEW 可见
  const { data: followingUpdates } = useSWR<{
    results: {
      media: { id: number; tmdbId: number; mediaType: 'movie' | 'tv' };
      episodeCount: number;
      newEpisodes: {
        seasonNumber: number;
        episodeNumber: number;
        addedAt: string;
      }[];
    }[];
  }>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.REQUEST_VIEW],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user.id}/following-updates?days=7&take=20`
      : null
  );

  const updateAvailableTitles = useCallback(
    (requestId: number, mediaTitle: MediaTitle) => {
      setAvailableTitles((titles) => ({
        ...titles,
        [requestId]: mediaTitle,
      }));
    },
    []
  );

  useEffect(() => {
    setAvailableTitles({});
  }, [user?.id]);

  if (!user && !error) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <>
      <PageTitle title={user.displayName} />
      {Object.keys(availableTitles).length > 0 && (
        <div className="absolute -top-16 left-0 right-0 z-0 h-96">
          <ImageFader
            key={user.id}
            isDarker
            backgroundImages={Object.values(availableTitles)
              .filter((media) => media.backdropPath)
              .map(
                (media) =>
                  `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${media.backdropPath}`
              )
              .slice(0, 6)}
          />
        </div>
      )}
      <ProfileHeader user={user} />
      <Achievements userId={user.id} />
      {quota &&
        (user.id === currentUser?.id ||
          currentHasPermission(
            [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
            { type: 'and' }
          )) && (
          <div className="relative z-40">
            <dl className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
                <dt className="truncate text-sm font-bold text-gray-300">
                  {intl.formatMessage(messages.totalrequests)}
                </dt>
                <dd className="mt-1 text-3xl font-semibold text-white">
                  <Link
                    href={
                      currentHasPermission(
                        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                        { type: 'or' }
                      )
                        ? `/users/${user?.id}/requests?filter=all`
                        : '/requests'
                    }
                  >
                    {intl.formatNumber(user.requestCount ?? 0)}
                  </Link>
                </dd>
              </div>
              <div
                className={`overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ${
                  quota.movie.restricted
                    ? 'bg-gradient-to-t from-red-900 to-transparent ring-red-500'
                    : 'ring-gray-700'
                } sm:p-6`}
              >
                <dt
                  className={`truncate text-sm font-bold ${
                    quota.movie.restricted ? 'text-red-500' : 'text-gray-300'
                  }`}
                >
                  {quota.movie.limit
                    ? intl.formatMessage(messages.pastdays, {
                        type: intl.formatMessage(messages.movierequests),
                        days: quota?.movie.days,
                      })
                    : intl.formatMessage(messages.movierequests)}
                </dt>
                <dd
                  className={`mt-1 flex items-center text-sm ${
                    quota.movie.restricted ? 'text-red-500' : 'text-white'
                  }`}
                >
                  {quota.movie.limit ? (
                    <>
                      <ProgressCircle
                        progress={Math.round(
                          ((quota?.movie.remaining ?? 0) /
                            (quota?.movie.limit ?? 1)) *
                            100
                        )}
                        useHeatLevel
                        className="mr-2 h-8 w-8"
                      />
                      <div>
                        {intl.formatMessage(messages.requestsperdays, {
                          limit: (
                            <span className="text-3xl font-semibold">
                              {intl.formatMessage(messages.limit, {
                                remaining: quota.movie.remaining,
                                limit: quota.movie.limit,
                              })}
                            </span>
                          ),
                        })}
                      </div>
                    </>
                  ) : (
                    <span className="text-3xl font-semibold">
                      {intl.formatMessage(messages.unlimited)}
                    </span>
                  )}
                </dd>
              </div>
              <div
                className={`overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ${
                  quota.tv.restricted
                    ? 'bg-gradient-to-t from-red-900 to-transparent ring-red-500'
                    : 'ring-gray-700'
                } sm:p-6`}
              >
                <dt
                  className={`truncate text-sm font-bold ${
                    quota.tv.restricted ? 'text-red-500' : 'text-gray-300'
                  }`}
                >
                  {quota.tv.limit
                    ? intl.formatMessage(messages.pastdays, {
                        type: intl.formatMessage(messages.seriesrequest),
                        days: quota?.tv.days,
                      })
                    : intl.formatMessage(messages.seriesrequest)}
                </dt>
                <dd
                  className={`mt-1 flex items-center text-sm ${
                    quota.tv.restricted ? 'text-red-500' : 'text-white'
                  }`}
                >
                  {quota.tv.limit ? (
                    <>
                      <ProgressCircle
                        progress={Math.round(
                          ((quota?.tv.remaining ?? 0) /
                            (quota?.tv.limit ?? 1)) *
                            100
                        )}
                        useHeatLevel
                        className="mr-2 h-8 w-8"
                      />
                      <div>
                        {intl.formatMessage(messages.requestsperdays, {
                          limit: (
                            <span className="text-3xl font-semibold">
                              {intl.formatMessage(messages.limit, {
                                remaining: quota.tv.remaining,
                                limit: quota.tv.limit,
                              })}
                            </span>
                          ),
                        })}
                      </div>
                    </>
                  ) : (
                    <span className="text-3xl font-semibold">
                      {intl.formatMessage(messages.unlimited)}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      {watchTime &&
        (user.id === currentUser?.id ||
          currentHasPermission(
            [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )) && (
          <div className="relative z-40">
            <dl className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
                <dt className="truncate text-sm font-bold text-gray-300">
                  {intl.formatMessage(messages.watchtimeToday)}
                </dt>
                <dd className="mt-1 text-3xl font-semibold text-white">
                  {formatDuration(watchTime.todaySeconds)}
                </dd>
              </div>
              <div className="overflow-hidden rounded-lg bg-gray-800/50 px-4 py-5 shadow ring-1 ring-gray-700 sm:p-6">
                <dt className="truncate text-sm font-bold text-gray-300">
                  {intl.formatMessage(messages.watchtimeTotal)}
                </dt>
                <dd className="mt-1 text-3xl font-semibold text-white">
                  {formatDuration(watchTime.totalSeconds)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      {(user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )) &&
        (!requests || !!requests.results.length) &&
        !requestError && (
          <>
            <div className="slider-header">
              <Link
                href={
                  currentHasPermission(
                    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                    { type: 'or' }
                  )
                    ? `/users/${user?.id}/requests?filter=all`
                    : '/requests'
                }
                className="slider-title"
              >
                <span>{intl.formatMessage(messages.recentrequests)}</span>
                <ArrowRightCircleIcon />
              </Link>
            </div>
            <Slider
              sliderKey="requests"
              isLoading={!requests}
              items={(requests?.results ?? []).map((request) => (
                <RequestCard
                  key={`request-slider-item-${request.id}`}
                  request={request}
                  onTitleData={updateAvailableTitles}
                />
              ))}
              placeholder={<RequestCard.Placeholder />}
            />
          </>
        )}

      {recentlyWatched && !!recentlyWatched.results.length && (
        <div className="relative z-40 mt-8">
          <div className="slider-header">
            <div className="slider-title">
              <span>{intl.formatMessage(messages.recentlyWatched)}</span>
            </div>
          </div>
          <Slider
            sliderKey="recently-watched"
            isLoading={!recentlyWatched}
            isEmpty={recentlyWatched.results.length === 0}
            emptyMessage={intl.formatMessage(messages.noRecentlyWatched)}
            items={recentlyWatched.results.map((item) => (
              <RecentlyWatchedCard
                key={`recently-watched-${item.mediaType}-${item.tmdbId}`}
                item={item}
              />
            ))}
            placeholder={
              <div className="h-40 w-28 animate-pulse rounded-lg bg-gray-800 sm:h-48 sm:w-32" />
            }
          />
        </div>
      )}

      {followingUpdates && !!followingUpdates.results.length && (
        <div className="relative z-40 mt-8">
          <div className="slider-header">
            <div className="slider-title">
              <span>{intl.formatMessage(messages.followingTitle)}</span>
            </div>
          </div>
          <div className="space-y-2">
            {followingUpdates.results.map((item) => (
              <FollowingUpdateRow
                key={`following-${item.media.tmdbId}`}
                item={item}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default UserProfile;
