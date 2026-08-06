import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProgressCircle from '@app/components/Common/ProgressCircle';
import ActivityTimeline from '@app/components/UserProfile/ActivityTimeline';
import ProfileHeader from '@app/components/UserProfile/ProfileHeader';
import RequestCompactRow from '@app/components/UserProfile/RequestCompactRow';
import WatchedSection from '@app/components/UserProfile/WatchedSection';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  QuotaResponse,
  UserActivityResponse,
  UserRequestsResponse,
  UserWatchTimeResponse,
  UserWatchedResponse,
} from '@server/interfaces/api/userInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile', {
  overview: 'Overview',
  watched: 'Watched',
  requests: 'Requests',
  stats: 'Stats',
  activity: 'Activity',
  viewAll: 'View All',
  totalrequests: 'Total Requests',
  watchtimeTotal: 'Total Watch Time',
  watchtimeToday: 'Watched Today',
  movierequests: 'Movie Requests',
  seriesrequest: 'Series Requests',
  pastdays: '{type} (past {days} days)',
  requestsperdays: '{limit} remaining',
  limit: '{remaining} of {limit}',
  unlimited: 'Unlimited',
  viewAllActivity: 'View All Activity',
  activityEmpty: 'No recent activity.',
  noRequests: 'No requests yet.',
  recentrequests: 'Recent Requests',
  updatedTo: 'Updated to S{season}E{episode}',
  watchedSeries: 'Watched Series',
  watchedMovies: 'Watched Movies',
  monthRequests: 'This Month Requests',
});

/** 把秒数格式化为小时（保留一位小数），不足 0.1 小时显示为 0.1h */
const formatDuration = (totalSeconds: number): string => {
  const hours = Math.round((totalSeconds / 3600) * 10) / 10;
  if (hours < 0.1) {
    return '0.1h';
  }
  const display = hours % 1 === 0 ? Math.round(hours) : hours;
  return `${display}h`;
};

type Tab = 'overview' | 'watched' | 'requests';

const UserProfile = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, error } = useUser({
    id: Number(router.query.userId),
  });
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [requestPage, setRequestPage] = useState(0);

  // 请求 Tab：本人 + REQUEST_VIEW 可见
  const canViewRequests =
    user &&
    (user.id === currentUser?.id ||
      currentHasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      ));
  const { data: requests } = useSWR<UserRequestsResponse>(
    canViewRequests
      ? `/api/v1/user/${user?.id}/requests?take=10&skip=${requestPage * 10}`
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
  const { data: activity } = useSWR<UserActivityResponse>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user.id}/activity?take=10&skip=0`
      : null
  );
  const { data: watchedData } = useSWR<UserWatchedResponse>(
    user &&
      (user.id === currentUser?.id ||
        currentHasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        ))
      ? `/api/v1/user/${user.id}/watched?take=500&skip=0`
      : null
  );
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
      ? `/api/v1/user/${user.id}/following-updates?days=30&take=50`
      : null
  );

  useEffect(() => {
    setActiveTab('overview');
    setRequestPage(0);
  }, [user?.id]);

  if (!user && !error) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <ErrorPage statusCode={404} />;
  }

  const tabClass = (tab: Tab) =>
    `flex-1 border-b-2 px-1 py-3 text-center text-sm font-medium transition ${
      activeTab === tab
        ? 'border-indigo-500 text-white'
        : 'border-transparent text-gray-400 hover:text-gray-200'
    }`;

  return (
    <div className="min-h-screen">
      <PageTitle title={user.displayName} />
      <ProfileHeader user={user} />

      {/* 关键数据带（Hero band） */}
      <div className="relative z-40 -mt-6 mb-8">
        <div className="mx-4 flex items-center justify-between rounded-2xl border border-gray-700 bg-gray-800/80 px-6 py-4 backdrop-blur">
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {intl.formatNumber(user.requestCount ?? 0)}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {intl.formatMessage(messages.totalrequests)}
            </div>
          </div>
          <div className="h-10 w-px bg-gray-700" />
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {watchTime ? formatDuration(watchTime.totalSeconds) : '--'}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {intl.formatMessage(messages.watchtimeTotal)}
            </div>
          </div>
          <div className="h-10 w-px bg-gray-700" />
          <div className="text-center">
            <div className="text-2xl font-bold text-white">
              {watchedData ? watchedData.pageInfo.results : '--'}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {intl.formatMessage(messages.watched)}
            </div>
          </div>
        </div>
      </div>

      {/* 吸顶 Tab */}
      <div className="sticky top-0 z-50 -mx-4 bg-gray-900/95 px-4 backdrop-blur">
        <div className="flex">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={tabClass('overview')}
          >
            {intl.formatMessage(messages.overview)}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('watched')}
            className={tabClass('watched')}
          >
            {intl.formatMessage(messages.watched)}
          </button>
          {canViewRequests && (
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={tabClass('requests')}
            >
              {intl.formatMessage(messages.requests)}
            </button>
          )}
        </div>
      </div>

      {/* ===== 总览 ===== */}
      {activeTab === 'overview' && (
        <div className="mt-6 space-y-8">
          {watchedData && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-gray-800/50 px-4 py-4 ring-1 ring-gray-700">
                <dt className="truncate text-xs font-bold text-gray-400">
                  {intl.formatMessage(messages.watchedSeries)}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-white">
                  {
                    watchedData.results.filter((r) => r.mediaType === 'tv')
                      .length
                  }
                </dd>
              </div>
              <div className="rounded-xl bg-gray-800/50 px-4 py-4 ring-1 ring-gray-700">
                <dt className="truncate text-xs font-bold text-gray-400">
                  {intl.formatMessage(messages.watchedMovies)}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-white">
                  {
                    watchedData.results.filter((r) => r.mediaType === 'movie')
                      .length
                  }
                </dd>
              </div>
              <div
                className={`col-span-2 rounded-xl px-4 py-4 ring-1 sm:col-span-1 ${
                  quota?.movie.restricted || quota?.tv.restricted
                    ? 'bg-gradient-to-t from-red-900/40 to-transparent ring-red-500/60'
                    : 'bg-gray-800/50 ring-gray-700'
                }`}
              >
                <dt className="truncate text-xs font-bold text-gray-400">
                  {intl.formatMessage(messages.monthRequests)}
                </dt>
                <dd className="mt-1 flex items-center gap-3">
                  <ProgressCircle
                    progress={
                      quota?.movie.limit || quota?.tv.limit
                        ? Math.round(
                            Math.max(
                              quota?.movie.limit
                                ? ((quota.movie.remaining ?? 0) /
                                    (quota.movie.limit ?? 1)) *
                                    100
                                : 100,
                              quota?.tv.limit
                                ? ((quota.tv.remaining ?? 0) /
                                    (quota.tv.limit ?? 1)) *
                                    100
                                : 100
                            )
                          )
                        : 100
                    }
                    useHeatLevel
                    className="h-8 w-8"
                  />
                  <span
                    className={`text-lg font-semibold ${
                      quota?.movie.restricted || quota?.tv.restricted
                        ? 'text-red-500'
                        : 'text-white'
                    }`}
                  >
                    {intl.formatMessage(messages.unlimited)}
                  </span>
                </dd>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            {/* 动态时间线（摘要：最近 10 条 + 查看全部） */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  {intl.formatMessage(messages.activity)}
                </h2>
                <Link
                  href={`/users/${user.id}/activity`}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  {intl.formatMessage(messages.viewAllActivity)} →
                </Link>
              </div>
              {!activity ? (
                <LoadingSpinner />
              ) : activity.results.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  {intl.formatMessage(messages.activityEmpty)}
                </div>
              ) : (
                <ActivityTimeline items={activity.results} />
              )}
            </section>
          </div>
        </div>
      )}

      {/* ===== 已看 ===== */}
      {activeTab === 'watched' && (
        <div className="mt-6">
          <WatchedSection userId={user.id} />
        </div>
      )}

      {/* ===== 请求 ===== */}
      {activeTab === 'requests' && canViewRequests && (
        <div className="mt-6">
          {requests && !!requests.results.length ? (
            <>
              <div className="space-y-2">
                {requests.results.map((request) => {
                  const update = followingUpdates?.results.find(
                    (u) => u.media.id === request.media?.id
                  );
                  return (
                    <RequestCompactRow
                      key={`request-${request.id}`}
                      request={request}
                      update={update}
                    />
                  );
                })}
              </div>
              {(requests.pageInfo.pages ?? 1) > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm text-gray-400">
                  <button
                    type="button"
                    onClick={() => setRequestPage((p) => Math.max(0, p - 1))}
                    disabled={requestPage === 0}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 ring-1 ring-gray-700 transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ‹ 上一页
                  </button>
                  <span>
                    {requestPage + 1}/{requests.pageInfo.pages ?? 1}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRequestPage((p) =>
                        Math.min((requests.pageInfo.pages ?? 1) - 1, p + 1)
                      )
                    }
                    disabled={requestPage >= (requests.pageInfo.pages ?? 1) - 1}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 ring-1 ring-gray-700 transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页 ›
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center text-sm text-gray-400">
              {intl.formatMessage(messages.noRequests)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserProfile;
