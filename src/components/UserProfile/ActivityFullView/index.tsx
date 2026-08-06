import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ActivityTimeline from '@app/components/UserProfile/ActivityTimeline';
import defineMessages from '@app/utils/defineMessages';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import type { UserActivityResponse } from '@server/interfaces/api/userInterfaces';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWRInfinite from 'swr/infinite';

const messages = defineMessages('components.UserProfile.ActivityFullView', {
  back: 'Back to Overview',
  allActivity: 'All Activity',
  all: 'All',
  watch: 'Watching',
  update: 'Updates',
  request: 'Requests',
  count: '{count} items',
  empty: 'No activity found.',
  loadMore: 'Load More',
});

type FilterType = 'all' | 'watch' | 'update' | 'request';

const PAGE_SIZE = 20;

interface ActivityFullViewProps {
  userId: number;
}

/**
 * 全部动态（独立路由 /users/:id/activity）
 *
 * 借用全局 ActivityList 的交互模式：useSWRInfinite 无限滚动累积追加 +
 * 服务端类型过滤，数据源保持 /user/:id/activity（含「剧集更新」事件）。
 */
const ActivityFullView = ({ userId }: ActivityFullViewProps) => {
  const intl = useIntl();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>('all');

  const getKey = (pageIndex: number): string | null => {
    const params = new URLSearchParams();
    params.set('take', String(PAGE_SIZE));
    params.set('skip', String(pageIndex * PAGE_SIZE));
    if (filter !== 'all') {
      params.set('type', filter);
    }
    return `/api/v1/user/${userId}/activity?${params.toString()}`;
  };

  const { data, error, isValidating, setSize } =
    useSWRInfinite<UserActivityResponse>(getKey);

  const allItems = useMemo(
    () => data?.flatMap((page) => page.results) ?? [],
    [data]
  );

  // 过滤条件变化时重置分页
  useEffect(() => {
    setSize(1);
  }, [filter, setSize]);

  // 无限滚动：列表底部 sentinel 进入视口时加载下一页
  const lastPage = data?.[data.length - 1];
  const hasMore = (lastPage?.pageInfo.results ?? 0) > allItems.length;
  const [sentinelRef, sentinelInView] = useInView({
    rootMargin: '200px',
    skip: !hasMore || allItems.length === 0,
  });
  useEffect(() => {
    if (sentinelInView && hasMore && !isValidating) {
      setSize((s) => s + 1);
    }
  }, [sentinelInView, hasMore, isValidating, setSize]);

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        {intl.formatMessage(messages.empty)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title={intl.formatMessage(messages.allActivity)} />
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/users/${userId}`)}
          className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 transition hover:bg-gray-700"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span>{intl.formatMessage(messages.back)}</span>
        </button>
        <h1 className="text-base font-bold text-white">
          {intl.formatMessage(messages.allActivity)}
        </h1>
        <span className="ml-auto text-xs text-gray-500">
          {intl.formatMessage(messages.count, { count: allItems.length })}
        </span>
      </div>

      {/* 类型过滤 */}
      <div className="mb-4 flex space-x-2">
        {(['all', 'watch', 'update', 'request'] as FilterType[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 ring-1 ring-gray-700 hover:bg-gray-700'
            }`}
          >
            {intl.formatMessage(
              f === 'all'
                ? messages.all
                : f === 'watch'
                  ? messages.watch
                  : f === 'update'
                    ? messages.update
                    : messages.request
            )}
          </button>
        ))}
      </div>

      {!data ? (
        <LoadingSpinner />
      ) : allItems.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.empty)}
        </div>
      ) : (
        <>
          <ActivityTimeline items={allItems} />
          {/* 无限滚动 sentinel */}
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-4"
          >
            {isValidating && (
              <span className="text-xs text-gray-500">
                {intl.formatMessage(messages.loadMore)}…
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ActivityFullView;
