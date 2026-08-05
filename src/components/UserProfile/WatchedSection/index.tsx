import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { ListBulletIcon, Squares2X2Icon } from '@heroicons/react/24/outline';
import type {
  UserWatchedResponse,
  WatchedItem,
} from '@server/interfaces/api/userInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.WatchedSection', {
  watched: 'Watched',
  all: 'All',
  series: 'Series',
  movies: 'Movies',
  episodes: '{watched}/{total} eps',
  completed: 'Completed',
  watching: 'Watching',
  empty: 'No watched titles yet.',
  generateReport: 'Generate Watch Report',
  watchTime: '{hours} h watched',
});

type FilterType = 'all' | 'movie' | 'tv';

/** 已看单条：海报 + 完成标记 + 进度 + 评分 */
const WatchedCard = ({ item }: { item: WatchedItem }) => {
  const intl = useIntl();
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(url);
  const href =
    item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
  const title = data ? (isMovie(data) ? data.title : data.name) : null;

  return (
    <Link href={href} className="group relative">
      <div className="relative">
        <CachedImage
          type="tmdb"
          src={
            data?.posterPath
              ? `https://image.tmdb.org/t/p/w342${data.posterPath}`
              : '/images/sinerr_poster_not_found.png'
          }
          alt=""
          className="aspect-[2/3] w-full rounded-lg object-cover"
          width={228}
          height={342}
        />
        {item.completed && (
          <span className="absolute right-1 top-1 rounded bg-green-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            ✓
          </span>
        )}
        {item.rating != null && (
          <span className="absolute right-1 top-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
            ★{item.rating}
          </span>
        )}
        {item.mediaType === 'tv' && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-800">
            <div
              className="h-full bg-yellow-500"
              style={{ width: `${item.watchedPercent ?? 0}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-1 line-clamp-1 text-xs text-gray-300">{title}</div>
      {item.mediaType === 'tv' && (
        <div className="text-[10px] text-gray-500">
          {item.totalCount
            ? intl.formatMessage(messages.episodes, {
                watched: item.watchedCount,
                total: item.totalCount,
              })
            : ''}
        </div>
      )}
    </Link>
  );
};

/** 已看列表行（列表模式） */
const WatchedRow = ({ item }: { item: WatchedItem }) => {
  const intl = useIntl();
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(url);
  const href =
    item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
  const title = data ? (isMovie(data) ? data.title : data.name) : null;

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
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
          {item.mediaType === 'tv' ? (
            <>
              <span className="text-indigo-400">
                {item.totalCount
                  ? intl.formatMessage(messages.episodes, {
                      watched: item.watchedCount,
                      total: item.totalCount,
                    })
                  : ''}
              </span>
              <span className="h-1 max-w-[120px] flex-1 rounded bg-gray-700">
                <span
                  className="block h-1 rounded bg-indigo-500"
                  style={{ width: `${item.watchedPercent ?? 0}%` }}
                />
              </span>
              <span>{item.completed ? '✓' : ''}</span>
            </>
          ) : (
            <span>
              {intl.formatMessage(messages.watchTime, {
                hours: Math.round((item.playDurationSeconds / 3600) * 10) / 10,
              })}
            </span>
          )}
          {item.rating != null && (
            <span className="ml-auto text-yellow-400">★{item.rating}</span>
          )}
        </div>
      </div>
    </Link>
  );
};

interface WatchedSectionProps {
  userId: number;
}

const WatchedSection = ({ userId }: WatchedSectionProps) => {
  const intl = useIntl();
  const [filter, setFilter] = useState<FilterType>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const { data, error } = useSWR<UserWatchedResponse>(
    `/api/v1/user/${userId}/watched?take=500&skip=0`
  );

  const filtered =
    data?.results.filter((r) => filter === 'all' || r.mediaType === filter) ??
    [];

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  }
  if (!data) {
    return <LoadingSpinner />;
  }
  if (filtered.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex space-x-2">
          {(['all', 'tv', 'movie'] as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                filter === f
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700'
              }`}
            >
              {intl.formatMessage(
                f === 'all'
                  ? messages.all
                  : f === 'tv'
                    ? messages.series
                    : messages.movies
              )}
            </button>
          ))}
        </div>
        <div className="flex space-x-1">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label="grid"
            className={`rounded-md p-1.5 ${
              view === 'grid'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Squares2X2Icon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-label="list"
            className={`rounded-md p-1.5 ${
              view === 'list'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ListBulletIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {filtered.map((item) => (
            <WatchedCard key={`${item.mediaType}-${item.tmdbId}`} item={item} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <WatchedRow key={`${item.mediaType}-${item.tmdbId}`} item={item} />
          ))}
        </div>
      )}

      <Link
        href={`/users/${userId}/report`}
        className="block w-full rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 py-2.5 text-center text-sm font-semibold text-white transition hover:from-indigo-500 hover:to-purple-500"
      >
        {intl.formatMessage(messages.generateReport)}
      </Link>
    </div>
  );
};

export default WatchedSection;
