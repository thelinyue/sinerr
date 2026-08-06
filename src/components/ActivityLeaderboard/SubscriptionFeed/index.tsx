import CachedImage from '@app/components/Common/CachedImage';
import defineMessages from '@app/utils/defineMessages';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.ActivityLeaderboard.SubscriptionFeed',
  {
    title: '更新速递',
    badge: '订阅中',
    count: '{total} 部 · {upcoming} 部将更新',
    collapse: '收起',
    expand: '展开',
    empty: '暂无订阅更新',
    upcomingDays: '{days} 天后',
    today: '今天',
    tomorrow: '明天',
    updatedTo: '已更新至 S{season}E{episode}',
    newEpisodes: '+{count} 集',
    finished: '已完结',
  }
);

interface FeedEntry {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  season?: number | null;
  name: string;
  year?: string | null;
  nextSeason?: number | null;
  nextEpisode?: number | null;
  nextAirDate?: string | null;
  lastAddedAt?: string | null;
  episodeCount?: number;
  posterPath?: string | null;
}

interface FeedResponse {
  generatedAt: number;
  entries: FeedEntry[];
}

/** 单张速递卡片：横版小海报 + 剧名 + 状态（金色=将更新 / 绿色=已更新） */
const FeedCard = ({ entry }: { entry: FeedEntry }) => {
  const intl = useIntl();
  const isTv = entry.mediaType === 'tv';
  const href = isTv ? `/tv/${entry.tmdbId}` : `/movie/${entry.tmdbId}`;

  // 状态文案：优先「将更新」，其次「最近更新」，最后完结/兜底
  let sub: React.ReactNode;
  let gold = false;
  let green = false;

  if (isTv && entry.nextAirDate) {
    const airDate = new Date(entry.nextAirDate);
    const diff = Math.ceil(
      (airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    const dayLabel =
      diff <= 0
        ? intl.formatMessage(messages.today)
        : diff === 1
          ? intl.formatMessage(messages.tomorrow)
          : intl.formatMessage(messages.upcomingDays, { days: diff });
    gold = true;
    sub = (
      <>
        {intl.formatMessage(messages.updatedTo, {
          season: entry.nextSeason ?? '',
          episode: entry.nextEpisode ?? '',
        })}
        <span className="ml-1 text-amber-300/80">· {dayLabel}</span>
      </>
    );
  } else if (entry.lastAddedAt) {
    green = true;
    sub = (
      <>
        {intl.formatMessage(messages.updatedTo, {
          season: entry.season ?? '',
          episode: entry.episodeCount ?? '',
        })}
        {entry.episodeCount ? (
          <span className="ml-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px]">
            {intl.formatMessage(messages.newEpisodes, {
              count: entry.episodeCount,
            })}
          </span>
        ) : null}
      </>
    );
  } else {
    green = true;
    sub = intl.formatMessage(messages.finished);
  }

  return (
    <Link href={href} className="w-[104px] flex-shrink-0">
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg">
        <CachedImage
          type="tmdb"
          src={
            entry.posterPath
              ? `https://image.tmdb.org/t/p/w342${entry.posterPath}`
              : '/images/sinerr_poster_not_found.png'
          }
          alt=""
          fill
          className="object-cover"
        />
      </div>
      <div className="mt-1 truncate text-[11px] font-medium text-gray-200">
        {entry.name}
      </div>
      <div
        className={`mt-0.5 truncate text-[10px] ${
          gold ? 'text-amber-400' : green ? 'text-emerald-400' : 'text-gray-500'
        }`}
      >
        {sub}
      </div>
    </Link>
  );
};

/** 更新速递折叠条：本周热播下方，展示 MoviePilot 订阅中影片的更新动态 */
const SubscriptionFeed = () => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const { data } = useSWR<FeedResponse>('/api/v1/settings/moviepilot/feed');

  if (!data || data.entries.length === 0) {
    return null;
  }

  const upcomingCount = data.entries.filter(
    (e) => e.mediaType === 'tv' && e.nextAirDate
  ).length;

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
            total: data.entries.length,
            upcoming: upcomingCount,
          })}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 text-gray-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="overflow-x-auto px-3 pb-3 [scrollbar-width:none]">
          <div className="flex gap-3">
            {data.entries.map((entry) => (
              <FeedCard
                key={`${entry.mediaType}-${entry.tmdbId}`}
                entry={entry}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionFeed;
