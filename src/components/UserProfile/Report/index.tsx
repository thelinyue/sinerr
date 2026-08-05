import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import {
  ArrowDownTrayIcon,
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
  completed: 'Completed',
  series: 'Series',
  movies: 'Movies',
  leaderboard: 'Leaderboard',
  byMonth: 'By Month',
  monthName: '{month}',
  months: 'Months',
  plays: '{count} plays',
  noData: 'No playback data for this year.',
  export: 'Export as PNG',
  exportAppTitle: 'Watch Report',
  exportedAt: 'Generated {date}',
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

/** 基于年度数据绘制并下载一张简洁报告卡片（原生 canvas，无外部依赖） */
const exportReportPng = (
  year: number,
  data: UserReportResponse,
  appTitle: string,
  generatedLabel: string
): void => {
  const W = 800;
  const H = 520;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 背景渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1e1b4b');
  grad.addColorStop(1, '#4c1d95');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 标题
  ctx.fillStyle = '#c7d2fe';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`${appTitle} · ${year}`, 48, 64);

  // 总时长
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(formatDuration(data.totalSeconds), 48, 150);
  ctx.fillStyle = '#a5b4fc';
  ctx.font = '18px sans-serif';
  ctx.fillText(data.totalSeconds > 0 ? generatedLabel : '', 48, 185);

  // 统计
  const stats: { label: string; value: number }[] = [
    {
      label: data.watchedTitles > 0 ? 'Viewed' : '',
      value: data.watchedTitles,
    },
    {
      label: data.completedTitles > 0 ? 'Completed' : '',
      value: data.completedTitles,
    },
    { label: data.tvTitles > 0 ? 'Series' : '', value: data.tvTitles },
    { label: data.movieTitles > 0 ? 'Movies' : '', value: data.movieTitles },
  ];
  let sx = 48;
  for (const s of stats) {
    if (!s.label) continue;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(String(s.value), sx, 250);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px sans-serif';
    ctx.fillText(s.label, sx, 280);
    sx += 170;
  }

  // 金榜
  if (data.topItems.length > 0) {
    ctx.fillStyle = '#c7d2fe';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Leaderboard', 48, 350);
    data.topItems.forEach((item, i) => {
      ctx.fillStyle = i === 0 ? '#fbbf24' : i === 1 ? '#cbd5e1' : '#b45309';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`${i + 1}.`, 48, 395 + i * 42);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '18px sans-serif';
      ctx.fillText(`TMDB #${item.tmdbId}`, 90, 395 + i * 42);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '15px sans-serif';
      ctx.fillText(
        `${item.playCount} plays · ${formatDuration(item.playDurationSeconds)}`,
        420,
        395 + i * 42
      );
    });
  }

  // 下载
  const link = document.createElement('a');
  link.download = `watch-report-${year}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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
  const [activeMonth, setActiveMonth] = useState<number | null>(null);

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
    setActiveMonth(null);
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
                      {data.watchedTitles}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.watchedTitles)}
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-white">
                      {data.completedTitles}
                    </div>
                    <div className="text-xs text-gray-400">
                      {intl.formatMessage(messages.completed)}
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
              {/* 月份下钻 */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white">
                  {intl.formatMessage(messages.byMonth)}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {monthsWithData.map((month) => (
                    <button
                      key={month.month}
                      type="button"
                      onClick={() => setActiveMonth(month.month)}
                      className={`rounded-lg px-2 py-2 text-center transition ${
                        activeMonth === month.month
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <div className="text-sm font-semibold">
                        {intl.formatMessage(messages.monthName, {
                          month: MONTH_NAMES[month.month - 1],
                        })}
                      </div>
                      <div
                        className={`text-[10px] ${
                          activeMonth === month.month
                            ? 'text-indigo-200'
                            : 'text-gray-500'
                        }`}
                      >
                        {intl.formatMessage(messages.plays, {
                          count: month.playCount,
                        })}
                      </div>
                    </button>
                  ))}
                </div>
                {activeMonth != null && (
                  <ReportMonthView
                    key={activeMonth}
                    month={monthsWithData.find((m) => m.month === activeMonth)!}
                  />
                )}
              </div>

              {/* 导出 */}
              <button
                type="button"
                onClick={() =>
                  exportReportPng(
                    year,
                    data,
                    intl.formatMessage(messages.exportAppTitle),
                    intl.formatMessage(messages.exportedAt, {
                      date: intl.formatDate(new Date(), {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      }),
                    })
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 py-2.5 text-sm font-semibold text-white transition hover:from-indigo-500 hover:to-purple-500"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {intl.formatMessage(messages.export)}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Report;
