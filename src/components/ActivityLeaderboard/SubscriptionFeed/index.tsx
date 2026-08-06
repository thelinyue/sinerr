import defineMessages from '@app/utils/defineMessages';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.ActivityLeaderboard.SubscriptionFeed',
  {
    title: '追剧日历',
    badge: '订阅中',
    count: '未来 7 天 · {count} 次更新',
    today: '今天',
    tomorrow: '明天',
    empty: '暂无更新',
    more: '+{count} 更多',
    collapse: '收起',
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
  updates: CalendarUpdate[];
  posterPath?: string | null;
}

interface FeedResponse {
  generatedAt: number;
  entries: FeedEntry[];
}

/** 集号标签：单集 S1E02，多集 S1E01-10（数据来自 TMDB air_date 实际更新数） */
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

/** 单日列：日期标题 + 纯文字条目 + 前5条更多 */
const DayColumn = ({
  label,
  dateLabel,
  entries,
  accent,
  className,
  empty,
}: {
  label: string;
  dateLabel: string;
  entries: FeedEntry[];
  accent: 'green' | 'gold' | 'normal';
  className: string;
  empty: string;
}) => {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(0, 5);
  const hiddenCount = entries.length - 5;

  const cwColor =
    accent === 'green'
      ? 'text-emerald-400'
      : accent === 'gold'
        ? 'text-amber-400'
        : 'text-gray-200';
  const epColor =
    accent === 'green'
      ? 'text-emerald-400'
      : accent === 'gold'
        ? 'text-amber-400'
        : 'text-gray-400';

  return (
    <div className={`min-w-0 rounded-xl p-2.5 ${className}`}>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className={`text-[13px] font-bold ${cwColor}`}>{label}</span>
        <span className="text-[10.5px] text-gray-500">{dateLabel}</span>
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
          {shown.map((entry) => (
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
              <span className={`flex-shrink-0 ${epColor}`}>
                {episodeLabel(entry.updates)}
              </span>
            </Link>
          ))}
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

/** 追剧日历：本周热播下方，展示订阅中影片未来 7 天更新（响应式 auto-fill 列数） */
const SubscriptionFeed = () => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const { data } = useSWR<FeedResponse>('/api/v1/settings/moviepilot/feed');

  // 未来 7 天日期序列（含今天），用于按日期分组展示
  const days = useMemo(() => {
    const arr: { iso: string; label: string; dateLabel: string }[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekdayNames = [
      '周日',
      '周一',
      '周二',
      '周三',
      '周四',
      '周五',
      '周六',
    ];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const label =
        i === 0
          ? intl.formatMessage(messages.today)
          : i === 1
            ? intl.formatMessage(messages.tomorrow)
            : weekdayNames[d.getDay()];
      arr.push({
        iso,
        label,
        dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      });
    }
    return arr;
  }, [intl]);

  if (!data || data.entries.length === 0) {
    return null;
  }

  // 每个日期下的条目
  const entriesByDay = (iso: string) =>
    data.entries.filter((e) => e.updates.some((u) => u.date === iso));
  const totalUpdates = data.entries.reduce(
    (sum, e) => sum + e.updates.length,
    0
  );

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
          {intl.formatMessage(messages.count, { count: totalUpdates })}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {days.map((day, i) => {
              const dayEntries = entriesByDay(day.iso);
              return (
                <DayColumn
                  key={day.iso}
                  label={day.label}
                  dateLabel={day.dateLabel}
                  entries={dayEntries}
                  accent={i === 0 ? 'green' : i === 1 ? 'gold' : 'normal'}
                  className={
                    i === 0
                      ? 'border border-emerald-500/25 bg-emerald-500/5'
                      : i === 1
                        ? 'border border-amber-500/20 bg-amber-500/5'
                        : 'border border-gray-700/50 bg-gray-800/40'
                  }
                  empty={intl.formatMessage(messages.empty)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionFeed;
