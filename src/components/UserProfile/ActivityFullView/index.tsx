import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ActivityTimeline from '@app/components/UserProfile/ActivityTimeline';
import defineMessages from '@app/utils/defineMessages';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import type { UserActivityResponse } from '@server/interfaces/api/userInterfaces';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.ActivityFullView', {
  back: 'Back to Overview',
  allActivity: 'All Activity',
  all: 'All',
  watch: 'Watching',
  update: 'Updates',
  request: 'Requests',
  count: '{count} items',
  empty: 'No activity found.',
});

type FilterType = 'all' | 'watch' | 'update' | 'request';

interface ActivityFullViewProps {
  userId: number;
}

/**
 * 全部动态（方案 C：独立路由 /users/:id/activity）
 *
 * 一次性拉取全部动态，前端按类型过滤，无分页。
 * 总览「查看全部」入口跳转到此页。
 */
const ActivityFullView = ({ userId }: ActivityFullViewProps) => {
  const intl = useIntl();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>('all');

  const { data, error } = useSWR<UserActivityResponse>(
    `/api/v1/user/${userId}/activity?take=500&skip=0`
  );

  const filtered = useMemo(() => {
    const items = data?.results ?? [];
    if (filter === 'all') return items;
    return items.filter((item) => item.type === filter);
  }, [data, filter]);

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
          {intl.formatMessage(messages.count, { count: filtered.length })}
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
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.empty)}
        </div>
      ) : (
        <ActivityTimeline items={filtered} />
      )}
    </div>
  );
};

export default ActivityFullView;
