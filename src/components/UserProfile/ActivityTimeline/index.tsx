import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { ArrowPathIcon, HeartIcon, PlayIcon } from '@heroicons/react/24/solid';
import type { ActivityItem } from '@server/interfaces/api/userInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.ActivityTimeline', {
  watchAction: 'watched',
  updateAction: 'has {count} new episode(s)',
  requestAction: 'requested',
  episode: 'S{season}E{episode}',
});

interface ActivityTimelineProps {
  items: ActivityItem[];
}

/** 相对时间：1 分钟内「刚刚」，否则分钟/小时/天，超 7 天显示日期 */
const useRelativeTime = (date: Date): string => {
  const intl = useIntl();
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 60) return intl.formatRelativeTime(0, 'second');
  if (absSec < 3600)
    return intl.formatRelativeTime(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400)
    return intl.formatRelativeTime(Math.round(diffSec / 3600), 'hour');
  if (absSec < 7 * 86400)
    return intl.formatRelativeTime(Math.round(diffSec / 86400), 'day');
  return intl.formatDate(date, { month: 'short', day: 'numeric' });
};

/** 单条时间线：懒加载媒体标题 + 类型图标 + 主文案 */
const TimelineRow = ({ item }: { item: ActivityItem }) => {
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
  const title = data ? (isMovie(data) ? data.title : data.name) : null;
  const timeText = useRelativeTime(item.createdAt);

  const icon =
    item.type === 'watch' ? (
      <PlayIcon className="h-4 w-4" />
    ) : item.type === 'update' ? (
      <ArrowPathIcon className="h-4 w-4" />
    ) : (
      <HeartIcon className="h-4 w-4" />
    );

  const iconClass =
    item.type === 'watch'
      ? 'bg-indigo-500/20 text-indigo-400'
      : item.type === 'update'
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-amber-500/20 text-amber-400';

  let main: React.ReactNode;
  if (item.type === 'watch') {
    const isTv = item.media.mediaType === 'tv';
    const ep =
      isTv && item.seasonNumber != null && item.episodeNumber != null
        ? ` ${intl.formatMessage(messages.episode, {
            season: item.seasonNumber,
            episode: item.episodeNumber,
          })}`
        : '';
    main = (
      <>
        {intl.formatMessage(messages.watchAction)}{' '}
        <Link href={href} className="font-semibold text-white hover:underline">
          {title ?? '\u00A0'}
        </Link>
        <span className="text-gray-400">{ep}</span>
      </>
    );
  } else if (item.type === 'update') {
    main = (
      <>
        <Link href={href} className="font-semibold text-white hover:underline">
          {title ?? '\u00A0'}
        </Link>{' '}
        {intl.formatMessage(messages.updateAction, {
          count: item.episodeCount ?? 0,
        })}
      </>
    );
  } else {
    main = (
      <>
        {intl.formatMessage(messages.requestAction)}{' '}
        <Link href={href} className="font-semibold text-white hover:underline">
          {title ?? '\u00A0'}
        </Link>
      </>
    );
  }

  return (
    <li className="relative flex items-start gap-3 py-3 pl-1">
      <span className="sr-only">{item.type}</span>
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${iconClass}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm text-gray-300">{main}</div>
        <div className="mt-0.5 text-xs text-gray-500">{timeText}</div>
      </div>
    </li>
  );
};

const ActivityTimeline = ({ items }: ActivityTimelineProps) => {
  return (
    <ul className="relative">
      {items.map((item, index) => (
        <TimelineRow
          key={`activity-${item.type}-${item.createdAt.toString()}-${index}`}
          item={item}
        />
      ))}
    </ul>
  );
};

export default ActivityTimeline;
