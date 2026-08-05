import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProgressCircle from '@app/components/Common/ProgressCircle';
import RequestCard from '@app/components/RequestCard';
import ActivityTimeline from '@app/components/UserProfile/ActivityTimeline';
import ProfileHeader from '@app/components/UserProfile/ProfileHeader';
import WatchedSection from '@app/components/UserProfile/WatchedSection';
import { Permission, useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  QuotaResponse,
  UserActivityResponse,
  UserRequestsResponse,
  UserWatchTimeResponse,
} from '@server/interfaces/api/userInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
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
  loadMore: 'Load More',
  activityEmpty: 'No recent activity.',
  recentrequests: 'Recent Requests',
  noRequests: 'No requests yet.',
});

type MediaTitle = MovieDetails | TvDetails;

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
  const [availableTitles, setAvailableTitles] = useState<
    Record<number, MediaTitle>
  >({});
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [activitySkip, setActivitySkip] = useState(0);

  // 请求 Tab：本人 + REQUEST_VIEW 可见
  const canViewRequests =
    user &&
    (user.id === currentUser?.id ||
      currentHasPermission(
        [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
        { type: 'or' }
      ));
  const { data: requests } = useSWR<UserRequestsResponse>(
    canViewRequests ? `/api/v1/user/${user?.id}/requests?take=10&skip=0` : null
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
      ? `/api/v1/user/${user.id}/activity?take=10&skip=${activitySkip}`
      : null
  );

  const updateAvailableTitles = useCallback(
    (requestId: number, mediaTitle: MediaTitle) => {
      setAvailableTitles((titles) => ({
        ...titles,
        [requestId]: mediaTitle,
      }));
    },
    []
  );

  useEffect(() => {
    setAvailableTitles({});
    setActiveTab('overview');
    setActivitySkip(0);
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
      {Object.keys(availableTitles).length > 0 && (
        <div className="absolute -top-16 left-0 right-0 z-0 h-96">
          <ImageFader
            key={user.id}
            isDarker
            backgroundImages={Object.values(availableTitles)
              .filter((media) => media.backdropPath)
              .map(
                (media) =>
                  `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${media.backdropPath}`
              )
              .slice(0, 6)}
          />
        </div>
      )}
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
              {watchTime ? formatDuration(watchTime.todaySeconds) : '--'}
            </div>
            <div className="mt-0.5 text-xs text-gray-400">
              {intl.formatMessage(messages.watchtimeToday)}
            </div>
          </div>
        </div>
      </div>

      {/* 吸顶 Tab */}
      <div className="sticky top-0 z-50 -mx-6 bg-gray-900/95 px-6 backdrop-blur sm:mx-0 sm:px-0">
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
          {quota && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-gray-800/50 px-4 py-4 ring-1 ring-gray-700">
                <dt className="truncate text-xs font-bold text-gray-400">
                  {quota.movie.limit
                    ? intl.formatMessage(messages.pastdays, {
                        type: intl.formatMessage(messages.movierequests),
                        days: quota.movie.days,
                      })
                    : intl.formatMessage(messages.movierequests)}
                </dt>
                <dd className="mt-1 flex items-center gap-3">
                  <ProgressCircle
                    progress={
                      quota.movie.limit
                        ? Math.round(
                            ((quota.movie.remaining ?? 0) /
                              (quota.movie.limit ?? 1)) *
                              100
                          )
                        : 100
                    }
                    useHeatLevel
                    className="h-8 w-8"
                  />
                  <span
                    className={`text-lg font-semibold ${
                      quota.movie.restricted ? 'text-red-500' : 'text-white'
                    }`}
                  >
                    {quota.movie.limit
                      ? intl.formatMessage(messages.limit, {
                          remaining: quota.movie.remaining,
                          limit: quota.movie.limit,
                        })
                      : intl.formatMessage(messages.unlimited)}
                  </span>
                </dd>
              </div>
              <div className="rounded-xl bg-gray-800/50 px-4 py-4 ring-1 ring-gray-700">
                <dt className="truncate text-xs font-bold text-gray-400">
                  {quota.tv.limit
                    ? intl.formatMessage(messages.pastdays, {
                        type: intl.formatMessage(messages.seriesrequest),
                        days: quota.tv.days,
                      })
                    : intl.formatMessage(messages.seriesrequest)}
                </dt>
                <dd className="mt-1 flex items-center gap-3">
                  <ProgressCircle
                    progress={
                      quota.tv.limit
                        ? Math.round(
                            ((quota.tv.remaining ?? 0) /
                              (quota.tv.limit ?? 1)) *
                              100
                          )
                        : 100
                    }
                    useHeatLevel
                    className="h-8 w-8"
                  />
                  <span
                    className={`text-lg font-semibold ${
                      quota.tv.restricted ? 'text-red-500' : 'text-white'
                    }`}
                  >
                    {quota.tv.limit
                      ? intl.formatMessage(messages.limit, {
                          remaining: quota.tv.remaining,
                          limit: quota.tv.limit,
                        })
                      : intl.formatMessage(messages.unlimited)}
                  </span>
                </dd>
              </div>
              <Link
                href={`/users/${user.id}/report`}
                className="flex items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-4 text-sm font-semibold text-white transition hover:from-indigo-500 hover:to-purple-500"
              >
                {intl.formatMessage(messages.viewAll)} →
              </Link>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* 动态时间线 */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  {intl.formatMessage(messages.activity)}
                </h2>
              </div>
              {!activity ? (
                <LoadingSpinner />
              ) : activity.results.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  {intl.formatMessage(messages.activityEmpty)}
                </div>
              ) : (
                <>
                  <ActivityTimeline items={activity.results} />
                  {activity.results.length >= 10 && (
                    <button
                      type="button"
                      onClick={() => setActivitySkip(activitySkip + 10)}
                      className="mt-2 w-full rounded-lg bg-gray-800 px-4 py-2 text-xs font-medium text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700"
                    >
                      {intl.formatMessage(messages.loadMore)}
                    </button>
                  )}
                </>
              )}
            </section>

            {/* 最近请求 */}
            {canViewRequests && requests && !!requests.results.length && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">
                    {intl.formatMessage(messages.recentrequests)}
                  </h2>
                  <Link
                    href={`/users/${user.id}/requests`}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    {intl.formatMessage(messages.viewAll)} →
                  </Link>
                </div>
                <div className="space-y-3">
                  {requests.results.map((request) => (
                    <RequestCard
                      key={`request-${request.id}`}
                      request={request}
                      onTitleData={updateAvailableTitles}
                    />
                  ))}
                </div>
              </section>
            )}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {requests.results.map((request) => (
                  <RequestCard
                    key={`request-${request.id}`}
                    request={request}
                    onTitleData={updateAvailableTitles}
                  />
                ))}
              </div>
              <div className="mt-6 text-center">
                <Link
                  href={`/users/${user.id}/requests`}
                  className="inline-block rounded-lg bg-gray-800 px-5 py-2 text-sm text-gray-300 ring-1 ring-gray-700 transition hover:bg-gray-700"
                >
                  {intl.formatMessage(messages.viewAll)} →
                </Link>
              </div>
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
