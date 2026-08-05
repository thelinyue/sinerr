import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { HeartIcon } from '@heroicons/react/24/solid';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentlyAddedHero', {
  updatedTo: '已更新至 第{episode}集',
  finished: '已完结 · 全{seasons}季 · {episodes}集',
  updatedSeason: '第{season}季',
  newEpisodes: '＋{count} 集',
  noResults: '暂无最近添加',
  viewAll: '查看全部',
  updatedOn: '{date} 更新',
});

interface NewEpisodeRef {
  seasonNumber: number;
  episodeNumber: number;
  addedAt: string;
}

interface RecentlyAddedItem {
  media: { id: number; tmdbId: number; mediaType: 'movie' | 'tv' };
  episodeCount: number;
  newEpisodes: NewEpisodeRef[];
  latestEventAt: string;
  voteCount: number;
}

/** 最新更新点：季最大优先，其次集最大（四处共用，决策 32） */
const computeLatestPoint = (newEpisodes: NewEpisodeRef[]) => {
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
};

interface HeroSlideProps {
  item: RecentlyAddedItem;
  active: boolean;
}

/** 单个 slide：懒加载媒体详情（TMDB），按展示规则渲染 */
const HeroSlide = ({ item, active }: HeroSlideProps) => {
  const intl = useIntl();
  const { ref, inView } = useInView({ triggerOnce: true });
  // 背景图加载失败/超时时回退到默认渐变
  const [imgError, setImgError] = useState(false);
  const url =
    item.media.mediaType === 'movie'
      ? `/api/v1/movie/${item.media.tmdbId}`
      : `/api/v1/tv/${item.media.tmdbId}`;
  const { data: title } = useSWR<MovieDetails | TvDetails>(
    inView && active ? url : null
  );

  // 标题变化（懒加载完成后拿到 backdropPath）时重置错误态
  useEffect(() => {
    setImgError(false);
  }, [title?.backdropPath]);

  const totalNew = item.episodeCount;
  const isEnded =
    item.media.mediaType === 'tv' &&
    !!title &&
    !isMovie(title) &&
    (title.status === 'Ended' || title.status === 'Canceled');

  const latestPoint = computeLatestPoint(item.newEpisodes);
  const mediaName = title
    ? isMovie(title)
      ? title.title
      : title.name
    : undefined;
  const href =
    item.media.mediaType === 'movie'
      ? `/movie/${item.media.tmdbId}`
      : `/tv/${item.media.tmdbId}`;

  let stateLine: React.ReactNode = null;
  if (item.media.mediaType === 'tv' && title && !isMovie(title)) {
    if (isEnded) {
      stateLine = (
        <div className="mt-3 flex items-center gap-2 sm:mt-4">
          <svg
            className="h-4 w-4 text-emerald-400"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span className="text-xs text-white/80 sm:text-sm">
            {intl.formatMessage(messages.finished, {
              seasons: title.numberOfSeasons,
              episodes: title.numberOfEpisodes,
            })}
          </span>
        </div>
      );
    } else if (latestPoint) {
      stateLine = (
        <div className="mt-3 flex items-center gap-2 sm:mt-4">
          <svg
            className="h-4 w-4 text-emerald-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-xs text-white/80 sm:text-sm">
            {intl.formatMessage(messages.updatedTo, {
              episode: latestPoint.episode,
            })}
          </span>
        </div>
      );
    }
  }

  return (
    <div ref={ref} className="flex h-full w-full flex-shrink-0 flex-col">
      <Link
        href={href}
        className="relative block h-full w-full overflow-hidden"
      >
        {title?.backdropPath && !imgError ? (
          <div className="absolute inset-0">
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w1280${title.backdropPath}`}
              alt=""
              fill
              priority={active}
              className="object-cover"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(125deg,#1f2937,#111827 70%)',
            }}
          />
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-4/5"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.9))' }}
        />

        {/* 左下内容区：预留圆点位，避免与圆点碰撞 */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-4 pb-10 sm:p-6 sm:pb-12 lg:p-7">
          {/* 剧名 + 季号一行：季号与剧名同排内联（同字号，略降透明度区分），剧名可截断、季号不收缩
              季号统一显示「最新更新季」：连载剧/已完结剧均为最近更新的那一季 */}
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 items-baseline gap-x-1.5">
              <span className="truncate text-lg font-bold leading-snug text-white drop-shadow sm:text-3xl">
                {mediaName ?? '\u00A0'}
              </span>
              {item.media.mediaType === 'tv' && title && latestPoint && (
                <span className="flex-shrink-0 text-lg font-bold leading-snug text-white/75 drop-shadow sm:text-3xl">
                  {intl.formatMessage(messages.updatedSeason, {
                    season: latestPoint.season,
                  })}
                </span>
              )}
            </div>
            {!isEnded && totalNew > 0 && (
              <span className="flex-shrink-0 rounded-full border border-emerald-400/40 bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 backdrop-blur sm:text-xs">
                {intl.formatMessage(messages.newEpisodes, { count: totalNew })}
              </span>
            )}
            {item.voteCount > 0 && (
              <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-pink-400/40 bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-pink-300 backdrop-blur sm:text-xs">
                <HeartIcon className="h-3 w-3" />
                {item.voteCount}
              </span>
            )}
          </div>
          {title && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-300 sm:mt-2.5 sm:text-sm">
              <span>
                {isMovie(title)
                  ? title.releaseDate?.slice(0, 4)
                  : title.firstAirDate?.slice(0, 4)}
              </span>
              <span className="text-gray-500">·</span>
              <span>{item.media.mediaType === 'tv' ? '剧集' : '电影'}</span>
              <span className="text-gray-500">·</span>
              <span className="text-amber-400">
                ★ {title.voteAverage?.toFixed(1)}
              </span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-400">
                {intl.formatMessage(messages.updatedOn, {
                  date: intl.formatDate(new Date(item.latestEventAt), {
                    month: 'numeric',
                    day: 'numeric',
                  }),
                })}
              </span>
            </div>
          )}
          {stateLine}
        </div>
      </Link>
    </div>
  );
};

/**
 * 探索页顶部轮播 Hero（最近事件）
 *
 * 常驻「发现」Tab 最上方，16:7 轮播；已完结剧/连载中/电影按展示规则渲染。
 * 门控：RECENT_VIEW 权限（模块 6）。
 */
const RecentlyAddedHero = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const { data } = useSWR<{ results: RecentlyAddedItem[] }>(
    '/api/v1/discover/recentlyadded?days=7&take=8'
  );

  const items = data?.results ?? [];

  // 离屏门控：进入视口才自动轮播，滚出即停（省电 + 避免回来时 slide 漂移）
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    timer.current = setInterval(() => {
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
    }, 6000);
  }, [items.length, stop]);

  useEffect(() => {
    if (items.length > 1 && !paused && inView) {
      start();
    }
    return stop;
  }, [items.length, paused, inView, start, stop]);

  if (!hasPermission(Permission.RECENT_VIEW)) {
    return null;
  }

  if (!data) {
    return (
      <div className="mb-5 flex h-40 items-center justify-center rounded-2xl bg-gray-800/50 ring-1 ring-gray-700">
        <LoadingSpinner />
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  const goTo = (i: number) => {
    setIndex((i + items.length) % items.length);
    start();
  };

  return (
    <div
      ref={containerRef}
      className="relative mb-6 overflow-hidden rounded-2xl ring-1 ring-gray-700/60"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        if (touchStartX.current == null) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        setPaused(false);
        const threshold = 50;
        if (deltaX < -threshold) {
          goTo(index + 1);
        } else if (deltaX > threshold) {
          goTo(index - 1);
        }
      }}
    >
      <div
        className="flex h-full transition-transform duration-500"
        style={{
          transform: `translateX(-${index * 100}%)`,
          height: 'clamp(200px, 26vw, 320px)',
        }}
      >
        {items.map((item, i) => (
          <HeroSlide
            key={`hero-${item.media.tmdbId}-${i}`}
            item={item}
            active={i === index}
          />
        ))}
      </div>

      {items.length > 1 && (
        <>
          <button
            aria-label="previous"
            onClick={() => goTo(index - 1)}
            className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/70 ring-1 ring-white/20 hover:bg-black/60 hover:text-white sm:block"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <button
            aria-label="next"
            onClick={() => goTo(index + 1)}
            className="absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/70 ring-1 ring-white/20 hover:bg-black/60 hover:text-white sm:block"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
            {items.map((item, i) => (
              <button
                key={`dot-${item.media.tmdbId}-${i}`}
                aria-label={`slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`}
              />
            ))}
          </div>
        </>
      )}

      {items.length > 0 && (
        <Link
          href="/discover/recentlyadded"
          className="absolute right-3 top-3 z-10 hidden rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur hover:bg-black/60 sm:block"
        >
          {intl.formatMessage(messages.viewAll)}
        </Link>
      )}
    </div>
  );
};

export default RecentlyAddedHero;
