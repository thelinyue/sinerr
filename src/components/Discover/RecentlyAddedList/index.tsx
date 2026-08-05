import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.Discover.RecentlyAddedList', {
  title: '最近添加',
  updatedTo: '已更新至 第{season}季 第{episode}集',
  finished: '已完结 · 全{seasons}季 · {episodes}集',
  newEpisodes: '＋{count} 集',
  loadMore: '加载更多',
  noResults: '暂无最近添加',
});

interface RecentItem {
  media: { id: number; tmdbId: number; mediaType: 'movie' | 'tv' };
  episodeCount: number;
  newEpisodes: {
    seasonNumber: number;
    episodeNumber: number;
    addedAt: string;
  }[];
}

const PAGE_SIZE = 20;

/** 横版卡片：懒加载详情 + 状态行 */
const RecentCard = ({ item }: { item: RecentItem }) => {
  const intl = useIntl();
  const { ref, inView } = useInView({ triggerOnce: true });
  // 背景图加载失败/超时时回退到默认渐变
  const [imgError, setImgError] = useState(false);
  const url =
    item.media.mediaType === 'movie'
      ? `/api/v1/movie/${item.media.tmdbId}`
      : `/api/v1/tv/${item.media.tmdbId}`;
  const { data: title } = useSWR<MovieDetails | TvDetails>(inView ? url : null);
  const href =
    item.media.mediaType === 'movie'
      ? `/movie/${item.media.tmdbId}`
      : `/tv/${item.media.tmdbId}`;

  // 标题懒加载完成后重置错误态
  useEffect(() => {
    setImgError(false);
  }, [title?.backdropPath]);

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
    !!title &&
    !isMovie(title) &&
    (title.status === 'Ended' || title.status === 'Canceled');

  let state: React.ReactNode = null;
  if (item.media.mediaType === 'tv' && title && !isMovie(title) && isEnded) {
    state = (
      <span className="text-[10px] text-emerald-300">
        {intl.formatMessage(messages.finished, {
          seasons: title.numberOfSeasons,
          episodes: title.numberOfEpisodes,
        })}
      </span>
    );
  } else if (latest) {
    state = (
      <span className="text-[10px] text-emerald-300">
        {intl.formatMessage(messages.updatedTo, {
          season: latest.seasonNumber,
          episode: latest.episodeNumber,
        })}
      </span>
    );
  }

  return (
    <Link href={href} className="block" ref={ref as never}>
      <div className="relative overflow-hidden rounded-xl ring-1 ring-gray-700">
        {title?.backdropPath && !imgError ? (
          <div className="relative aspect-video">
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w780${title.backdropPath}`}
              alt=""
              fill
              className="object-cover"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div
            className="aspect-video"
            style={{
              background: 'linear-gradient(125deg,#1f2937,#111827 70%)',
            }}
          />
        )}
        {!isEnded && item.episodeCount > 0 && (
          <span className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur">
            {intl.formatMessage(messages.newEpisodes, {
              count: item.episodeCount,
            })}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="truncate text-xs font-semibold text-white">
            {title ? (isMovie(title) ? title.title : title.name) : '\u00A0'}
          </p>
          {state}
        </div>
      </div>
    </Link>
  );
};

/**
 * 最近添加 · 查看全部（Sinerr 2.0 模块 4-E3）
 *
 * 复用 /discover/recentlyadded 端点分页，横版卡片网格。
 * 门控：RECENT_VIEW。
 */
const RecentlyAddedList = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();

  const getKey = (pageIndex: number) =>
    `/api/v1/discover/recentlyadded?days=7&take=${PAGE_SIZE}&skip=${
      pageIndex * PAGE_SIZE
    }`;

  const { data, setSize, isLoading } = useSWRInfinite<{
    results: RecentItem[];
    pageInfo: { results: number };
  }>(getKey);

  const allItems = data?.flatMap((page) => page.results) ?? [];
  const hasMore =
    (data?.[data.length - 1]?.pageInfo.results ?? 0) > allItems.length;

  const [sentinelRef, sentinelInView] = useInView({
    rootMargin: '200px',
    skip: !hasMore,
  });
  useEffect(() => {
    if (sentinelInView && hasMore) {
      setSize((s) => s + 1);
    }
  }, [sentinelInView, hasMore, setSize]);

  if (!hasPermission(Permission.RECENT_VIEW)) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        {intl.formatMessage(messages.noResults)}
      </div>
    );
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.title)} />
      <div className="mb-5 mt-1 flex items-center gap-1.5 text-lg font-semibold text-white">
        <span>{intl.formatMessage(messages.title)}</span>
      </div>
      {isLoading && !allItems.length ? (
        <LoadingSpinner />
      ) : allItems.length === 0 ? (
        <div className="rounded-lg bg-gray-800/50 p-8 text-center text-sm text-gray-500">
          {intl.formatMessage(messages.noResults)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {allItems.map((item) => (
              <RecentCard key={`recent-${item.media.tmdbId}`} item={item} />
            ))}
          </div>
          <div ref={sentinelRef} className="mt-4" />
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setSize((s) => s + 1)}
                className="rounded-lg bg-gray-800 px-5 py-2 text-xs font-medium text-gray-300 ring-1 ring-gray-700"
              >
                {intl.formatMessage(messages.loadMore)}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default RecentlyAddedList;
