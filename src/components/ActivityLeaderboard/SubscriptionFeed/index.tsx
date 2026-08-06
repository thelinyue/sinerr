import defineMessages from '@app/utils/defineMessages';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.ActivityLeaderboard.SubscriptionFeed',
  {
    title: '追剧日历',
    badge: '订阅中',
    count: '今日 {today} · 明日 {tomorrow}',
    today: '今天',
    tomorrow: '明天',
    empty: '暂无更新',
    more: '+{count} 更多',
    collapse: '收起',
    updated: '已更新',
    upcoming: '将更新',
  }
);

interface CalendarUpdate {
  date: string;
  season: number;
  episode: number;
}

interface FeedEntry {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  name: string;
  todayUpdates: CalendarUpdate[];
  tomorrowUpdates: CalendarUpdate[];
  posterPath?: string | null;
}

interface FeedResponse {
  generatedAt: number;
  entries: FeedEntry[];
}

/** 集号标签：单集 S1E02，多集 S1E01-E05 */
const episodeLabel = (updates: CalendarUpdate[]): string => {
  if (updates.length === 0) return '';
  const first = updates[0];
  if (updates.length === 1) {
    return `S${first.season}E${String(first.episode).padStart(2, '0')}`;
  }
  const last = updates[updates.length - 1];
  const sameSeason = first.season === last.season;
  return `S${first.season}E${String(first.episode).padStart(2, '0')}-${
    sameSeason ? '' : `S${last.season}E`
  }${String(last.episode).padStart(2, '0')}`;
};

/** 单列（今天/明天）：纯文字条目 + 前5条更多 */
const DayColumn = ({
  label,
  date,
  entries,
  accent,
  className,
  empty,
}: {
  label: string;
  date: string;
  entries: FeedEntry[];
  accent: 'green' | 'gold';
  className: string;
  empty: string;
}) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, 5);
  const hiddenCount = entries.length - 5;

  return (
    <div className={`rounded-xl p-2.5 ${className}`}>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span
          className={`text-[13px] font-bold ${
            accent === 'green' ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          {label}
        </span>
        <span className="text-[10.5px] text-gray-500">{date}</span>
        <span className="ml-auto text-[10px] text-gray-500">
          {entries.length} 部
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="py-2 text-center text-[11px] text-gray-600">
          {empty}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map((entry) => {
            const updates =
              accent === 'green' ? entry.todayUpdates : entry.tomorrowUpdates;
            return (
              <Link
                key={`${entry.mediaType}-${entry.tmdbId}`}
                href={
                  entry.mediaType === 'movie'
                    ? `/movie/${entry.tmdbId}`
                    : `/tv/${entry.tmdbId}`
                }
                className="flex items-baseline gap-1 truncate text-[11.5px] leading-5 hover:underline"
              >
                <span className="truncate text-gray-200">{entry.name}</span>
                <span
                  className={`flex-shrink-0 ${
                    accent === 'green' ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {episodeLabel(updates)}
                </span>
              </Link>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 rounded-md bg-gray-800/60 py-1 text-[10.5px] text-indigo-400 hover:bg-gray-800"
            >
              {expanded
                ? intl.formatMessage(messages.collapse)
                : intl.formatMessage(messages.more, { count: hiddenCount })}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/** 追剧日历：本周热播下方，展示订阅中影片今日/明日更新 */
const SubscriptionFeed = () => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const { data } = useSWR<FeedResponse>('/api/v1/settings/moviepilot/feed');

  if (!data || data.entries.length === 0) {
    return null;
  }

  const todayEntries = data.entries.filter((e) => e.todayUpdates.length > 0);
  const tomorrowEntries = data.entries.filter(
    (e) => e.tomorrowUpdates.length > 0
  );

  const now = new Date();
  const todayDate = `${now.getMonth() + 1}/${now.getDate()}`;
  const tmr = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDate = `${tmr.getMonth() + 1}/${tmr.getDate()}`;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-[13px] font-semibold text-gray-100">
          {intl.formatMessage(messages.title)}
        </span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          {intl.formatMessage(messages.badge)}
        </span>
        <span className="ml-auto text-[11px] text-gray-500">
          {intl.formatMessage(messages.count, {
            today: todayEntries.length,
            tomorrow: tomorrowEntries.length,
          })}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="flex gap-2.5 px-3 pb-3">
          <DayColumn
            label={intl.formatMessage(messages.today)}
            date={todayDate}
            entries={todayEntries}
            accent="green"
            className="border border-emerald-500/25 bg-emerald-500/5"
            empty={intl.formatMessage(messages.empty)}
          />
          <DayColumn
            label={intl.formatMessage(messages.tomorrow)}
            date={tomorrowDate}
            entries={tomorrowEntries}
            accent="gold"
            className="border border-amber-500/20 bg-amber-500/5"
            empty={intl.formatMessage(messages.empty)}
          />
        </div>
      )}
    </div>
  );
};

export default SubscriptionFeed;
