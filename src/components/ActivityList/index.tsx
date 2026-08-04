import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import UserAvatar from '@app/components/Common/UserAvatar';
import { notifyActivityRead } from '@app/hooks/useActivityUnreadCount';
import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ExclamationTriangleIcon,
  HeartIcon,
  ListBulletIcon,
  PlayIcon,
  StarIcon,
  TicketIcon,
  UserIcon,
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
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useInView } from 'react-intersection-observer';
import type { MessageDescriptor } from 'react-intl';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
const messages = defineMessages('components.ActivityList', {
  activity: 'Activity',
  loadmore: 'Load More',
  noactivity: 'No recent activity yet.',
  noactivityRequests: 'No requests yet.',
  noactivityVotes: 'No votes yet.',
  noactivityIssues: 'No issues reported yet.',
  noactivityPlayback: 'No playback records yet.',
  noactivityReviews: 'No reviews yet.',
  actorrequested: 'requested',
  actorvoted: 'also wants',
  actorissue: 'reported an issue for',
  actorplayback: 'watched',
  actorplaybackpartial: 'is watching',
  actorreviewed: 'reviewed',
  loadFailed: 'Unable to load activity.',
  filterAll: 'All',
  filterRequest: 'Requests',
  filterVote: 'Votes',
  filterIssue: 'Issues',
  filterPlayback: 'Playback',
  filterReview: 'Reviews',
  filterByUser: 'Filtering by {name}',
  filterMine: 'Mine',
  clearFilter: 'Clear',
  me: 'me',
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
  watchedFor: 'watched {duration}',
  minutes: '{count} min',
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
      case 'review':
        return intl.formatMessage(messages.actorreviewed);
      case 'playback':
        return intl.formatMessage(
          item.payload.completed
            ? messages.actorplayback
            : messages.actorplaybackpartial
        );
    }
  })();

  // 剧集播放记录显示集数：S01E02 形式（无季号时只显示 E02）
  const episodeLabel =
    item.type === 'playback' && item.payload.episodeNumber != null
      ? item.payload.seasonNumber != null
        ? `S${item.payload.seasonNumber}E${item.payload.episodeNumber}`
        : `E${item.payload.episodeNumber}`
      : null;

  // 播放时长：始终显示，不足 1 分钟按秒显示，否则按分钟
  const playbackDuration =
    item.type === 'playback' && item.payload.durationSeconds != null
      ? item.payload.durationSeconds < 60
        ? `${Math.round(item.payload.durationSeconds)}${
            intl.locale.startsWith('zh') ? ' 秒' : 's'
          }`
        : `${Math.round(item.payload.durationSeconds / 60)}${
            intl.locale.startsWith('zh') ? ' 分钟' : ' min'
          }`
      : null;

  // 短评星级（1-5）
  const rating =
    item.type === 'review' && item.payload.rating ? item.payload.rating : null;

  const typeIcon = (() => {
    switch (item.type) {
      case 'vote':
        return <HeartIcon className="h-6 w-6 text-pink-500" />;
      case 'issue':
        return <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />;
      case 'playback':
        return <PlayIcon className="h-6 w-6 text-green-500" />;
      case 'review':
        return <StarIcon className="h-6 w-6 text-amber-400" />;
      default:
        return (
          <Tooltip content={intl.formatMessage(messages.activity)}>
            <TicketIcon className="h-6 w-6 text-indigo-400" />
          </Tooltip>
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
        <UserAvatar
          user={item.actor}
          size="md"
          className={`sm:h-14 sm:w-14 ${isMine ? 'ring-2 ring-indigo-400' : ''}`}
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
          {episodeLabel && (
            <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-xs font-medium text-gray-300">
              {episodeLabel}
            </span>
          )}
          {playbackDuration && (
            <span className="text-xs text-gray-400">{playbackDuration}</span>
          )}
        </div>
        {/* 短评内容 + 星级 */}
        {item.type === 'review' && item.payload.message && (
          <div className="mt-1 flex items-start gap-2">
            {rating && (
              <span className="flex flex-shrink-0 items-center gap-0.5 text-amber-400">
                {Array.from({ length: 5 }, (_, i) => (
                  <StarIcon
                    key={i}
                    className={`h-3.5 w-3.5 ${
                      i < rating ? 'text-amber-400' : 'text-gray-600'
                    }`}
                  />
                ))}
              </span>
            )}
            <span className="line-clamp-2 text-xs text-gray-400 sm:text-sm">
              {item.payload.message}
            </span>
          </div>
        )}
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
      <div className="flex-shrink-0 text-gray-500">{typeIcon}</div>
    </div>
  );
};

// 骨架屏条目：加载期间展示占位，避免整屏 spinner
const ActivitySkeleton = () => (
  <div className="flex items-center gap-4 px-4 py-4 sm:gap-5 sm:px-8 sm:py-5">
    <div className="h-16 w-11 flex-shrink-0 animate-pulse rounded-md bg-gray-700/50 sm:h-24 sm:w-16" />
    <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-full bg-gray-700/50 sm:h-14 sm:w-14" />
    <div className="min-w-0 flex-1 space-y-2">
      <div className="h-4 w-2/3 animate-pulse rounded bg-gray-700/50" />
      <div className="h-3 w-1/3 animate-pulse rounded bg-gray-700/40" />
    </div>
    <div className="h-6 w-6 flex-shrink-0 animate-pulse rounded-full bg-gray-700/50" />
  </div>
);

const typeTabs: { key: ActivityType | 'all'; label: MessageDescriptor }[] = [
  { key: 'all', label: messages.filterAll },
  { key: 'request', label: messages.filterRequest },
  { key: 'vote', label: messages.filterVote },
  { key: 'issue', label: messages.filterIssue },
  { key: 'playback', label: messages.filterPlayback },
  { key: 'review', label: messages.filterReview },
];

// 类型过滤图标（方案 C：图标行）
const filterIcons: Record<ActivityType | 'all', ReactNode> = {
  all: <ListBulletIcon className="h-5 w-5" />,
  request: <TicketIcon className="h-5 w-5" />,
  vote: <HeartIcon className="h-5 w-5" />,
  issue: <ExclamationTriangleIcon className="h-5 w-5" />,
  playback: <PlayIcon className="h-5 w-5" />,
  review: <StarIcon className="h-5 w-5" />,
};

/** 判断某天相对今天：0=今天, 1=昨天, >1=更早 */
const dayDiff = (date: Date): number => {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfToday.getTime() - target.getTime()) / 86400000);
};

const PAGE_SIZE = 20;

interface ActivityListProps {
  /** 过滤跳转的基准路径（嵌入 Discover 动态 Tab 时传 '/discover'） */
  basePath?: string;
  /** 是否渲染页面标题（嵌入时隐藏） */
  showPageTitle?: boolean;
  /** 嵌入模式：去掉页面级内边距（由外层容器负责留白） */
  embedded?: boolean;
}

const ActivityList = ({
  basePath = '/activity',
  showPageTitle = true,
  embedded = false,
}: ActivityListProps) => {
  const intl = useIntl();
  const { user } = useUser();
  const router = useRouter();
  const tabsRef = useRef<HTMLDivElement>(null);

  const activeType = (router.query.type as ActivityType | 'all') ?? 'all';
  const filterUserId = router.query.userId
    ? Number(router.query.userId)
    : undefined;
  const lastScrolledTypeRef = useRef<ActivityType | 'all'>(activeType);

  const { data: filterUser } = useSWR<User>(
    filterUserId ? `/api/v1/user/${filterUserId}` : null
  );

  // 实时刷新：每 60s 静默轮询，新动作自动出现
  // 无限滚动：固定页大小（take=20）+ skip 分页，useSWRInfinite 自动累积追加
  const getKey = (pageIndex: number): string | null => {
    if (!user) {
      return null;
    }
    const params = new URLSearchParams();
    params.set('take', String(PAGE_SIZE));
    params.set('skip', String(pageIndex * PAGE_SIZE));
    if (activeType !== 'all') {
      params.set('type', activeType);
    }
    if (filterUserId) {
      params.set('userId', String(filterUserId));
    }
    return `/api/v1/activity?${params.toString()}`;
  };

  const { data, error, isValidating, size, setSize } = useSWRInfinite<{
    results: ActivityItem[];
  }>(getKey, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  });

  // 累积追加的所有条目（各页 results 平铺）
  const allItems = useMemo(
    () => data?.flatMap((page) => page.results) ?? [],
    [data]
  );

  // 还有更多：最后加载的一页返回了满页数据
  const lastPage = data?.[data.length - 1];
  const hasMore = (lastPage?.results.length ?? 0) >= PAGE_SIZE;

  // 过滤条件变化时重置分页（key 变化后 useSWRInfinite 自动从第一页开始）
  useEffect(() => {
    setSize(1);
  }, [activeType, filterUserId, setSize]);

  // 分类切换后：等新分类数据就绪，把标签栏滚动到视口顶部（scroll-mt 贴齐固定头部），
  // 避免在 feed 重载期（页面变短）滚动被钳制
  useEffect(() => {
    if (lastScrolledTypeRef.current === activeType) {
      return;
    }
    if (data?.[0]?.results?.length) {
      lastScrolledTypeRef.current = activeType;
      requestAnimationFrame(() => {
        tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [activeType, data]);

  // 进入动态流即标记已读（模块 1：写入 localStorage 并广播，让侧栏/Tab 红点立即消失）
  useEffect(() => {
    try {
      localStorage.setItem('activity-last-seen', new Date().toISOString());
    } catch {
      // localStorage may not be available
    }
    notifyActivityRead();
  }, []);

  const setFilter = (updates: {
    type?: ActivityType | 'all';
    userId?: number | null;
  }) => {
    // 保留现有 query（如嵌入时的 tab=activity、搜索 query 等），仅更新 type/userId
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(router.query)) {
      if (typeof value === 'string') {
        params.set(key, value);
      }
    }
    const type = updates.type ?? activeType;
    if (type !== 'all') {
      params.set('type', type);
    } else {
      params.delete('type');
    }
    if (updates.userId) {
      params.set('userId', String(updates.userId));
    } else {
      params.delete('userId');
    }
    const qs = params.toString();
    // scroll:false 避免默认跳到最上方；shallow 避免 getInitialProps 重跑导致滚动重置
    // 实际滚动到标签位置由下方 useEffect（数据就绪后）执行
    router.push({ pathname: basePath, query: qs || undefined }, undefined, {
      scroll: false,
      shallow: true,
    });
  };

  // 无限滚动：列表底部 sentinel 进入视口时加载下一页
  const [sentinelRef, sentinelInView] = useInView({
    rootMargin: '200px',
    skip: !hasMore || allItems.length === 0,
  });
  useEffect(() => {
    if (sentinelInView && hasMore && !isValidating) {
      setSize((s) => s + 1);
    }
  }, [sentinelInView, hasMore, isValidating, setSize]);

  // 日期分组：今天 / 昨天 / 更早
  const grouped = useMemo(() => {
    const groups: { label: MessageDescriptor; items: ActivityItem[] }[] = [
      { label: messages.today, items: [] },
      { label: messages.yesterday, items: [] },
      { label: messages.earlier, items: [] },
    ];
    for (const item of allItems) {
      const diff = dayDiff(new Date(item.createdAt));
      const idx = diff <= 0 ? 0 : diff === 1 ? 1 : 2;
      groups[idx].items.push(item);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [allItems]);

  if (!data && !error) {
    return (
      <div className={embedded ? 'mb-0 px-0' : 'mb-8 px-4 sm:px-8'}>
        {showPageTitle && (
          <PageTitle title={intl.formatMessage(messages.activity)} />
        )}
        <div className="mb-6 flex items-center space-x-2 overflow-x-auto">
          {typeTabs.map((tab) => (
            <div
              key={tab.key}
              className="h-9 w-16 flex-shrink-0 animate-pulse rounded-full bg-gray-800/60"
            />
          ))}
        </div>
        <div className="overflow-hidden rounded-lg bg-gray-800/50 shadow ring-1 ring-gray-700">
          <div className="divide-y divide-gray-700/60">
            {Array.from({ length: 6 }, (_, i) => (
              <ActivitySkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const emptyMessage = (() => {
    switch (activeType) {
      case 'request':
        return messages.noactivityRequests;
      case 'vote':
        return messages.noactivityVotes;
      case 'issue':
        return messages.noactivityIssues;
      case 'playback':
        return messages.noactivityPlayback;
      case 'review':
        return messages.noactivityReviews;
      default:
        return messages.noactivity;
    }
  })();

  return (
    <>
      {showPageTitle && (
        <PageTitle title={intl.formatMessage(messages.activity)} />
      )}
      <div className={embedded ? 'mb-0 px-0' : 'mb-8 px-4 sm:px-8'}>
        {/* 类型过滤（方案 C：图标行 + 只看我开关）；scroll-mt 贴齐固定头部 */}
        <div
          ref={tabsRef}
          className="mb-6 flex scroll-mt-16 items-center justify-between gap-3"
        >
          <div className="hide-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
            {typeTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter({ type: tab.key })}
                className={`flex flex-shrink-0 flex-col items-center gap-1 rounded-lg px-3 py-1.5 transition ${
                  activeType === tab.key
                    ? 'text-indigo-300'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {filterIcons[tab.key]}
                <span className="text-[10px] font-medium">
                  {intl.formatMessage(tab.label)}
                </span>
              </button>
            ))}
          </div>
          {/* 只看我 */}
          <button
            type="button"
            onClick={() =>
              setFilter({
                userId: filterUserId === user?.id ? null : user?.id,
              })
            }
            className={`flex flex-shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
              filterUserId === user?.id
                ? 'bg-indigo-600/15 text-indigo-300 ring-indigo-500/40'
                : 'bg-gray-800/60 text-gray-400 ring-gray-700 hover:text-gray-200'
            }`}
          >
            <UserIcon className="h-3.5 w-3.5" />
            {intl.formatMessage(messages.filterMine)}
          </button>
        </div>

        {/* 用户筛选提示 */}
        {filterUserId && filterUserId !== user?.id && (
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

        {grouped.length === 0 ? (
          <div className="rounded-lg bg-gray-800/50 p-8 text-center text-sm text-gray-500 shadow ring-1 ring-gray-700">
            {intl.formatMessage(emptyMessage)}
          </div>
        ) : (
          <>
            {grouped.map((group) => (
              <div key={group.label.id} className="mb-8">
                <div className="mb-3 flex items-center gap-3 px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {intl.formatMessage(group.label)}
                  </span>
                  <div className="h-px flex-1 bg-gray-700/60" />
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-800/50 shadow ring-1 ring-gray-700">
                  <div className="divide-y divide-gray-700/60">
                    {group.items.map((item) => (
                      <ActivityFeedItem
                        key={`${item.type}-${item.id}`}
                        item={item}
                        currentUserId={user?.id}
                        onFilterUser={(uid) => setFilter({ userId: uid })}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {/* 无限滚动 sentinel */}
            <div ref={sentinelRef} className="mt-4" />
            {isValidating && size > 1 && (
              <div className="flex items-center justify-center py-4">
                <LoadingSpinner />
              </div>
            )}
            {!hasMore && (
              <div className="mt-6 flex justify-center text-xs text-gray-500">
                {intl.formatMessage(messages.noactivity)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default ActivityList;
