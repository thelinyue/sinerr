import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ExclamationTriangleIcon,
  HeartIcon,
  PlayIcon,
  TicketIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type {
  ActivityItem,
  ActivityType,
} from '@server/interfaces/api/activityInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import type { MessageDescriptor } from 'react-intl';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ActivityList', {
  activity: 'Activity',
  loadmore: 'Load More',
  noactivity: 'No recent activity yet.',
  actorrequested: 'requested',
  actorvoted: 'also wants',
  actorissue: 'reported an issue for',
  actorplayback: 'watched',
  actorplaybackpartial: 'is watching',
  loadFailed: 'Unable to load activity.',
  filterAll: 'All',
  filterRequest: 'Requests',
  filterVote: 'Votes',
  filterIssue: 'Issues',
  filterPlayback: 'Playback',
  filterByUser: 'Filtering by {name}',
  clearFilter: 'Clear',
  me: 'me',
});

const isMovie = (movie: MovieDetails | TvDetails): movie is MovieDetails => {
  return (movie as MovieDetails).title !== undefined;
};

interface ActivityFeedItemProps {
  item: ActivityItem;
  currentUserId?: number;
  onFilterUser: (userId: number) => void;
}

const ActivityFeedItem = ({
  item,
  currentUserId,
  onFilterUser,
}: ActivityFeedItemProps) => {
  const intl = useIntl();
  const { ref, inView } = useInView({ triggerOnce: true });
  const url = item.payload.tmdbId
    ? item.payload.mediaType === 'movie'
      ? `/api/v1/movie/${item.payload.tmdbId}`
      : `/api/v1/tv/${item.payload.tmdbId}`
    : null;
  const { data: title } = useSWR<MovieDetails | TvDetails>(
    inView && url ? url : null
  );

  const mediaTitle = title ? (isMovie(title) ? title.title : title.name) : null;
  const href =
    item.payload.mediaType === 'movie'
      ? `/movie/${item.payload.tmdbId}`
      : `/tv/${item.payload.tmdbId}`;
  const isMine = currentUserId === item.actor.id;

  const verb = (() => {
    switch (item.type) {
      case 'request':
        return intl.formatMessage(messages.actorrequested);
      case 'vote':
        return intl.formatMessage(messages.actorvoted);
      case 'issue':
        return intl.formatMessage(messages.actorissue);
      case 'playback':
        return intl.formatMessage(
          item.payload.completed
            ? messages.actorplayback
            : messages.actorplaybackpartial
        );
    }
  })();

  return (
    <div
      ref={ref}
      className={`flex items-center gap-4 px-4 py-4 sm:gap-5 sm:px-8 sm:py-5 ${
        isMine ? 'bg-indigo-500/5' : ''
      }`}
      data-testid="activity-item"
    >
      {/* 海报缩略图（移动端缩小显示，桌面端放大） */}
      <Link href={href} className="flex-shrink-0" aria-label={mediaTitle ?? ''}>
        <CachedImage
          type="tmdb"
          src={
            title?.posterPath
              ? `https://image.tmdb.org/t/p/w154${title.posterPath}`
              : '/images/sinerr_poster_not_found.png'
          }
          alt=""
          className="h-16 w-11 rounded-md object-cover sm:h-24 sm:w-16"
          width={64}
          height={96}
        />
      </Link>
      {/* 头像 */}
      <button
        type="button"
        onClick={() => onFilterUser(item.actor.id)}
        className="flex-shrink-0"
        aria-label={item.actor.displayName}
        title={item.actor.displayName}
      >
        <CachedImage
          type="avatar"
          src={item.actor.avatar}
          alt=""
          className={`h-10 w-10 rounded-full object-cover sm:h-14 sm:w-14 ${
            isMine ? 'ring-2 ring-indigo-400' : ''
          }`}
          width={56}
          height={56}
        />
      </button>
      <div className="min-w-0 flex-1 text-sm text-gray-300 sm:text-base">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-semibold text-white">
            {item.actor.displayName}
          </span>
          {isMine && (
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
              {intl.formatMessage(messages.me)}
            </span>
          )}
          <span>{verb}</span>
          {mediaTitle ? (
            <Link
              href={href}
              className="font-medium text-white hover:underline"
            >
              {mediaTitle}
            </Link>
          ) : (
            <span className="text-gray-500">
              {intl.formatMessage(messages.loadFailed)}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500 sm:text-sm">
          <FormattedRelativeTime
            value={Math.floor(
              (new Date(item.createdAt).getTime() - Date.now()) / 1000
            )}
            updateIntervalInSeconds={60}
            numeric="auto"
          />
        </div>
      </div>
      <div className="flex-shrink-0 text-gray-500">
        {item.type === 'vote' ? (
          <HeartIcon className="h-6 w-6 text-pink-500" />
        ) : item.type === 'issue' ? (
          <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />
        ) : item.type === 'playback' ? (
          <PlayIcon className="h-6 w-6 text-green-500" />
        ) : (
          <Tooltip content={intl.formatMessage(messages.activity)}>
            <TicketIcon className="h-6 w-6 text-indigo-400" />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

const typeTabs: { key: ActivityType | 'all'; label: MessageDescriptor }[] = [
  { key: 'all', label: messages.filterAll },
  { key: 'request', label: messages.filterRequest },
  { key: 'vote', label: messages.filterVote },
  { key: 'issue', label: messages.filterIssue },
  { key: 'playback', label: messages.filterPlayback },
];

const ActivityList = () => {
  const intl = useIntl();
  const { user } = useUser();
  const router = useRouter();
  const [take, setTake] = useState(20);

  const activeType = (router.query.type as ActivityType | 'all') ?? 'all';
  const filterUserId = router.query.userId
    ? Number(router.query.userId)
    : undefined;

  const { data: filterUser } = useSWR<User>(
    filterUserId ? `/api/v1/user/${filterUserId}` : null
  );

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('take', String(take));
    if (activeType !== 'all') {
      params.set('type', activeType);
    }
    if (filterUserId) {
      params.set('userId', String(filterUserId));
    }
    return params.toString();
  }, [take, activeType, filterUserId]);

  const { data, error, isValidating } = useSWR<{ results: ActivityItem[] }>(
    user ? `/api/v1/activity?${query}` : null
  );

  const setFilter = (updates: {
    type?: ActivityType | 'all';
    userId?: number | null;
  }) => {
    const params = new URLSearchParams();
    const type = updates.type ?? activeType;
    if (type !== 'all') {
      params.set('type', type);
    }
    if (updates.userId) {
      params.set('userId', String(updates.userId));
    }
    const qs = params.toString();
    router.push({ pathname: '/activity', query: qs || undefined });
  };

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.activity)} />
      <div className="mb-8 px-4 sm:px-8">
        {/* 类型过滤 tabs */}
        <div className="hide-scrollbar mb-6 flex items-center space-x-2 overflow-x-auto">
          {typeTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter({ type: tab.key })}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${
                activeType === tab.key
                  ? 'bg-indigo-600 text-white ring-indigo-500'
                  : 'bg-gray-800/60 text-gray-300 ring-gray-700 hover:bg-gray-700'
              }`}
            >
              {intl.formatMessage(tab.label)}
            </button>
          ))}
        </div>

        {/* 用户筛选提示 */}
        {filterUserId && (
          <div className="mb-4 flex items-center space-x-2 text-sm text-gray-300">
            <span>
              {intl.formatMessage(messages.filterByUser, {
                name: filterUser?.displayName ?? `#${filterUserId}`,
              })}
            </span>
            <Button
              buttonType="ghost"
              buttonSize="sm"
              onClick={() => setFilter({ userId: null })}
            >
              <XMarkIcon className="h-4 w-4" />
              <span>{intl.formatMessage(messages.clearFilter)}</span>
            </Button>
          </div>
        )}

        {data.results.length === 0 ? (
          <div className="rounded-lg bg-gray-800/50 p-8 text-center text-sm text-gray-500 shadow ring-1 ring-gray-700">
            {intl.formatMessage(messages.noactivity)}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg bg-gray-800/50 shadow ring-1 ring-gray-700">
              <div className="divide-y divide-gray-700/60">
                {data.results.map((item) => (
                  <ActivityFeedItem
                    key={`${item.type}-${item.id}`}
                    item={item}
                    currentUserId={user?.id}
                    onFilterUser={(uid) => setFilter({ userId: uid })}
                  />
                ))}
              </div>
            </div>
            {data.results.length >= take && !isValidating && (
              <div className="mt-6 flex justify-center">
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => setTake(take + 20)}
                >
                  {intl.formatMessage(messages.loadmore)}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default ActivityList;
