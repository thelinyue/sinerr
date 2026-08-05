import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid';
import type {
  ReportMonth,
  ReportMonthItem,
  UserReportResponse,
} from '@server/interfaces/api/userInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.Report', {
  report: 'Watch Report',
  back: 'Back',
  year: '{year}',
  totalTime: 'Total Watch Time',
  playCount: 'Play Count',
  watchedTitles: 'Titles',
  series: 'Series',
  movies: 'Movies',
  leaderboard: 'Leaderboard',
  byMonth: 'By Month',
  monthName: '{month}',
  months: 'Months',
  plays: '{count} plays',
  noData: 'No playback data for this year.',
});

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

/** 金榜/月度条目：懒加载标题 */
const ReportItemRow = ({ item }: { item: ReportMonthItem }) => {
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
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-gray-700/50"
    >
      <span className="text-sm text-gray-400">{title ?? '\u00A0'}</span>
      <span className="ml-auto text-xs text-gray-500">
        {intl.formatMessage(messages.plays, { count: item.playCount })}
      </span>
      <span className="w-16 text-right text-xs text-yellow-400">
        {formatDuration(item.playDurationSeconds)}
      </span>
    </Link>
  );
};

const ReportMonthView = ({ month }: { month: ReportMonth }) => {
  const intl = useIntl();
  return (
    <div className="overflow-hidden rounded-xl bg-gray-800/60">
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2.5">
        <span className="text-sm font-semibold text-white">
          {intl.formatMessage(messages.monthName, {
            month: MONTH_NAMES[month.month - 1],
          })}
        </span>
        <span className="text-xs text-gray-400">
          {intl.formatMessage(messages.plays, { count: month.playCount })}
        </span>
      </div>
      <div className="py-1">
        {month.items.map((item) => (
          <ReportItemRow key={`${month.month}-${item.tmdbId}`} item={item} />
        ))}
      </div>
    </div>
  );
};

const Report = () => {
  const router = useRouter();
  const intl = useIntl();
  const userId = Number(router.query.userId);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data, error } = useSWR<UserReportResponse>(
    `/api/v1/user/${userId}/report?year=${year}`
  );

  const monthsWithData = useMemo(() => data?.months ?? [], [data]);

  const goBack = () => {
    router.push(`/users/${userId}`);
  };

  const changeYear = (delta: number) => {
    const next = year + delta;
    if (next < currentYear - 5 || next > currentYear) return;
    setYear(next);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title={intl.formatMessage(messages.report)} />
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 transition hover:bg-gray-700"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span>{intl.formatMessage(messages.back)}</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeYear(-1)}
            aria-label="prev year"
            className="rounded-lg bg-gray-800 p-1.5 text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="min-w-[70px] text-center text-base font-bold text-white">
            {intl.formatMessage(messages.year, { year })}
          </span>
          <button
            type="button"
            onClick={() => changeYear(1)}
            aria-label="next year"
            className="rounded-lg bg-gray-800 p-1.5 text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!data && !error && <LoadingSpinner />}
      {error && (
        <div className="py-12 text-center text-sm text-gray-400">
          {intl.formatMessage(messages.noData)}
        </div>
      )}

      {data && (
        <>
          {data.watchedTitles === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              {intl.formatMessage(messages.noData)}
            </div>
          ) : (
            <div className="space-y-6">
              {/* 年度 Hero */}
              <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-900/40 to-purple-900/30 p-6">
                <div className="text-4xl font-extrabold text-white">
                  {formatDuration(data.totalSeconds)}
                </div>
                <div className="mt-1 text-sm text-indigo-300">
                  {intl.formatMessage(messages.totalTime)}
                </div>
                <div className="mt-5 flex gap-8">
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {data.playCount}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.playCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {data.watchedTitles}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.watchedTitles)}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {data.tvTitles}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.series)}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {data.movieTitles}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.movies)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 金榜 */}
              {data.topItems.length > 0 && (
                <div className="rounded-xl bg-gray-800/60 p-4">
                  <div className="mb-2 text-sm font-semibold text-white">
                    {intl.formatMessage(messages.leaderboard)}
                  </div>
                  {data.topItems.map((item, index) => (
                    <div
                      key={`top-${item.tmdbId}`}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                    >
                      <span
                        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                          index === 0
                            ? 'bg-amber-400 text-black'
                            : index === 1
                              ? 'bg-gray-300 text-black'
                              : 'bg-amber-700 text-white'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <ReportItemRow item={item} />
                    </div>
                  ))}
                </div>
              )}

              {/* 月份下钻 */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white">
                  {intl.formatMessage(messages.byMonth)}
                </div>
                {monthsWithData.map((month) => (
                  <ReportMonthView key={month.month} month={month} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Report;
