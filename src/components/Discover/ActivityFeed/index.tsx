import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Tooltip from '@app/components/Common/Tooltip';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ExclamationTriangleIcon,
  HeartIcon,
  TicketIcon,
} from '@heroicons/react/24/solid';
import type { ActivityItem } from '@server/interfaces/api/activityInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.ActivityFeed', {
  activity: 'Recent Activity',
  loadmore: 'Load More',
  noactivity: 'No recent activity yet.',
  actorrequested: 'requested',
  actorvoted: 'also wants',
  actorissue: 'reported an issue for',
  loadFailed: 'Unable to load activity.',
});

const isMovie = (movie: MovieDetails | TvDetails): movie is MovieDetails => {
  return (movie as MovieDetails).title !== undefined;
};

interface ActivityFeedItemProps {
  item: ActivityItem;
}

const ActivityFeedItem = ({ item }: ActivityFeedItemProps) => {
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

  const verb = (() => {
    switch (item.type) {
      case 'request':
        return intl.formatMessage(messages.actorrequested);
      case 'vote':
        return intl.formatMessage(messages.actorvoted);
      case 'issue':
        return intl.formatMessage(messages.actorissue);
    }
  })();

  return (
    <div
      ref={ref}
      className="flex items-center space-x-3 py-3"
      data-testid="activity-item"
    >
      <Link
        href={`/users/${item.actor.id}`}
        className="flex-shrink-0"
        aria-label={item.actor.displayName}
      >
        <CachedImage
          type="avatar"
          src={item.actor.avatar}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
          width={32}
          height={32}
        />
      </Link>
      <div className="min-w-0 flex-1 text-sm text-gray-300">
        <span className="font-semibold text-white">
          {item.actor.displayName}
        </span>{' '}
        {verb}{' '}
        {mediaTitle ? (
          <Link href={href} className="font-medium text-white hover:underline">
            {mediaTitle}
          </Link>
        ) : (
          <span className="text-gray-500">
            {intl.formatMessage(messages.loadFailed)}
          </span>
        )}
        <span className="ml-1.5 whitespace-nowrap text-xs text-gray-500">
          <FormattedRelativeTime
            value={Math.floor(
              (new Date(item.createdAt).getTime() - Date.now()) / 1000
            )}
            updateIntervalInSeconds={60}
            numeric="auto"
          />
        </span>
      </div>
      <div className="flex-shrink-0 text-gray-500">
        {item.type === 'vote' ? (
          <HeartIcon className="h-5 w-5 text-pink-500" />
        ) : item.type === 'issue' ? (
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
        ) : (
          <Tooltip content={intl.formatMessage(messages.activity)}>
            <TicketIcon className="h-5 w-5 text-indigo-400" />
          </Tooltip>
        )}
      </div>
    </div>
  );
};

const ActivityFeed = () => {
  const intl = useIntl();
  const { user } = useUser();
  const [take, setTake] = useState(10);

  const { data, error, isValidating } = useSWR<{ results: ActivityItem[] }>(
    user ? `/api/v1/activity?take=${take}` : null
  );

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  if (data.results.length === 0) {
    return null;
  }

  const hasMore = data.results.length >= take;

  return (
    <div className="mx-4 mb-8 rounded-lg bg-gray-800/50 p-4 shadow ring-1 ring-gray-700">
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.activity)}</span>
        </div>
      </div>
      <div className="divide-y divide-gray-700/60">
        {data.results.map((item) => (
          <ActivityFeedItem key={`${item.type}-${item.id}`} item={item} />
        ))}
      </div>
      {hasMore && !isValidating && (
        <div className="mt-4 flex justify-center">
          <Button
            buttonType="ghost"
            buttonSize="sm"
            onClick={() => setTake(take + 10)}
          >
            {intl.formatMessage(messages.loadmore)}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
