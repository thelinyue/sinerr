import SubscriptionFeed from '@app/components/ActivityLeaderboard/SubscriptionFeed';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { Transition } from '@headlessui/react';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl, type MessageDescriptor } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ActivityLeaderboard', {
  title: '本周热播',
  tabAll: '全部',
  tabMovie: '电影',
  tabTv: '剧集',
  expandMore: '展开更多 ▾（{count}）',
  collapse: '收起 ▴',
  viewAll: '查看完整榜单 →',
  watchCount: '{count} 次 · {watchers} 人',
  empty: '本周暂无观看记录',
  rank1: '🥇 第一名',
  rank2: '🥈 第二名',
  rank3: '🥉 第三名',
  close: '关闭',
});

interface WatchedUser {
  id: number;
  displayName: string;
  avatar: string;
}

interface WatchedItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  watchCount: number;
  watchers: number;
  durationSeconds: number;
  users: WatchedUser[];
}

type Filter = 'all' | 'movie' | 'tv';

/** 单个领奖台卡片：横版背景图 + 名次 + 名称 + 相对人气条（颜色表名次、条长表热度） */
const PodiumCard = ({
  rank,
  item,
  maxCount,
}: {
  rank: 1 | 2 | 3;
  item: WatchedItem;
  maxCount: number;
}) => {
  const intl = useIntl();
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data: title } = useSWR<MovieDetails | TvDetails>(url);
  const name = title ? (isMovie(title) ? title.title : title.name) : null;
  const backdrop = title?.backdropPath
    ? `https://image.tmdb.org/t/p/w780${title.backdropPath}`
    : null;
  const href =
    item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;

  const rankPill =
    rank === 1
      ? intl.formatMessage(messages.rank1)
      : rank === 2
        ? intl.formatMessage(messages.rank2)
        : intl.formatMessage(messages.rank3);

  // 人气条相对 Top1 的比例（至少 8% 保证可见）
  const pct = Math.max(8, Math.round((item.watchCount / maxCount) * 100));

  return (
    <a
      href={href}
      className={`relative block min-w-0 cursor-pointer text-center transition-transform hover:-translate-y-1 ${
        rank === 1 ? 'max-w-[340px] flex-[1.4]' : 'max-w-[240px] flex-[1]'
      }`}
    >
      {rank === 1 && <div className="h-6 animate-pulse text-xl">👑</div>}
      <div
        className={`relative mx-auto aspect-video w-full overflow-hidden rounded-[10px] ${
          rank === 1 ? 'ring-2 ring-amber-400/60' : ''
        }`}
      >
        {backdrop ? (
          <CachedImage
            type="tmdb"
            src={backdrop}
            alt=""
            fill
            className="object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-white"
            style={{
              background:
                item.mediaType === 'movie'
                  ? 'linear-gradient(135deg,#1d4ed8,#7c3aed)'
                  : 'linear-gradient(135deg,#0f766e,#0891b2)',
            }}
          >
            {item.mediaType === 'movie' ? '影' : '剧'}
          </div>
        )}
      </div>
      <div className="mt-2 inline-block rounded-full bg-gray-800/70 px-2.5 py-0.5 text-xs font-bold text-white ring-1 ring-gray-700">
        {rankPill}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-white">
        {name ?? '\u00A0'}
      </div>
      <div
        className={`mt-0.5 text-[11px] ${
          rank === 1 ? 'font-semibold text-amber-200' : 'text-gray-400'
        }`}
      >
        {intl.formatMessage(messages.watchCount, {
          count: item.watchCount,
          watchers: item.watchers,
        })}
      </div>
      {/* 相对人气条：颜色表名次（金/银/铜），条长表热度（相对 Top1） */}
      <div
        className={`mx-auto mt-2 rounded-t ${
          rank === 1
            ? 'h-2.5 bg-gradient-to-r from-amber-400 to-amber-500'
            : rank === 2
              ? 'h-1.5 bg-gradient-to-r from-slate-300 to-slate-400'
              : 'h-1.5 bg-gradient-to-r from-amber-600 to-amber-700'
        }`}
        style={{ width: `${pct}%` }}
      />
    </a>
  );
};

/** 4-8 名列表行（含完整榜单弹窗行，懒加载媒体详情；背景填充表相对人气） */
const ListRow = ({
  rank,
  item,
  maxCount,
}: {
  rank: number;
  item: WatchedItem;
  maxCount: number;
}) => {
  const { ref, inView } = useInView({ triggerOnce: true });
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  // 行进入视口才拉取详情，避免弹窗/长列表一次性并发请求
  const { data: title } = useSWR<MovieDetails | TvDetails>(inView ? url : null);
  const name = title ? (isMovie(title) ? title.title : title.name) : null;
  const backdrop = title?.backdropPath
    ? `https://image.tmdb.org/t/p/w300${title.backdropPath}`
    : null;
  const href =
    item.mediaType === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`;
  // 背景填充相对 Top1 的比例
  const pct = Math.max(5, Math.round((item.watchCount / maxCount) * 100));

  return (
    <a
      ref={ref}
      href={href}
      className="relative flex items-center gap-3 overflow-hidden rounded-lg px-2 py-1.5 transition hover:bg-gray-700/50"
    >
      {/* 相对人气背景填充（经典排行榜样式） */}
      <div
        className="absolute inset-y-0 left-0 bg-indigo-500/15"
        style={{ width: `${pct}%` }}
      />
      <span className="relative w-5 flex-shrink-0 text-center text-sm font-bold text-gray-500">
        {rank}
      </span>
      <div className="relative h-[30px] w-[52px] flex-shrink-0 overflow-hidden rounded">
        {backdrop ? (
          <CachedImage
            type="tmdb"
            src={backdrop}
            alt=""
            fill
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gray-800" />
        )}
      </div>
      <span className="relative min-w-0 flex-1 truncate text-sm text-gray-200">
        {name ?? '\u00A0'}
      </span>
      <span className="relative flex-shrink-0 text-xs text-gray-400">
        {item.watchCount}次
      </span>
    </a>
  );
};

/** 背景单层：拉取影片 backdrop 作整卡背景，active 控制透明度实现交叉渐变 */
const BackdropLayer = ({
  item,
  active,
}: {
  item: WatchedItem;
  active: boolean;
}) => {
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(url);
  const backdrop = data?.backdropPath
    ? `https://image.tmdb.org/t/p/w1280${data.backdropPath}`
    : null;

  if (!backdrop) {
    return null;
  }

  return (
    <div
      className={`absolute inset-0 transition-opacity duration-1000 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* 仅激活层播放 Ken Burns 缩放，离屏/非激活层不占 GPU */}
      <div
        className={`h-full w-full bg-cover bg-center ${
          active
            ? 'animate-[leaderboard-kenburns_12s_ease-in-out_infinite_alternate]'
            : ''
        }`}
        style={{ backgroundImage: `url('${backdrop}')` }}
      />
    </div>
  );
};

/** Top1-3 backdrop 交叉渐变轮播：每 8s 切换，hover 暂停，离屏停止 */
const LeaderboardBackground = ({
  items,
  paused,
  inView,
}: {
  items: WatchedItem[];
  paused: boolean;
  inView: boolean;
}) => {
  const top = items.slice(0, 3);
  // 以内容标识为依赖：筛选变化导致榜单变化时回到第一张
  const topKey = top.map((i) => `${i.mediaType}-${i.tmdbId}`).join('|');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [topKey]);

  useEffect(() => {
    // 离屏（inView=false）或暂停时不轮播，避免无谓的状态更新
    if (paused || !inView || top.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % top.length), 8000);
    return () => clearInterval(t);
  }, [paused, inView, topKey, top.length]);

  if (top.length === 0) {
    return null;
  }

  return (
    <>
      {top.map((item, i) => (
        <BackdropLayer
          key={`bg-${item.mediaType}-${item.tmdbId}`}
          item={item}
          active={i === idx}
        />
      ))}
      {/* 底部渐变压暗，保证前景文字可读 */}
      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/85 via-gray-900/30 to-gray-900/50" />
    </>
  );
};

/** 动态 Tab 顶部「本周热播」领奖台（折叠式） */
const ActivityLeaderboard = () => {
  const intl = useIntl();
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 进入可视区才轮播背景；离屏停止以省电
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams({ days: '7', take: '8' });
    if (filter !== 'all') params.set('mediaType', filter);
    return params.toString();
  }, [filter]);

  const { data } = useSWR<{ results: WatchedItem[] }>(
    `/api/v1/activity/watched?${query}`
  );
  const { data: allData } = useSWR<{ results: WatchedItem[] }>(
    showAll ? `/api/v1/activity/watched?days=7&take=20` : null
  );

  const items = data?.results ?? [];
  const top = items.slice(0, 3);
  const rest = items.slice(3);
  // 人气条基准：Top1 观看次数（相对比例）
  const maxCount = top[0]?.watchCount ?? 1;
  const allItems = allData?.results ?? [];

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="group relative mb-6 overflow-hidden rounded-xl border border-gray-700/60 bg-gray-800/50"
    >
      {/* 背景层：Top1-3 backdrop 交叉渐变轮播（Ken Burns + 入场淡入 + hover 提亮） */}
      <div
        className={`absolute inset-0 brightness-[0.45] transition duration-500 group-hover:brightness-[0.55] ${
          inView ? 'animate-[leaderboard-bg-fadein_0.8s_ease-out]' : 'opacity-0'
        }`}
      >
        <LeaderboardBackground items={top} paused={paused} inView={inView} />
      </div>
      <div className="relative z-10 p-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-shrink-0 text-sm font-bold text-white">
            <span className="mr-1.5">🏆</span>
            {intl.formatMessage(messages.title)}
          </h2>
          <div className="hide-scrollbar flex items-center gap-1 overflow-x-auto">
            {(
              [
                ['all', messages.tabAll],
                ['movie', messages.tabMovie],
                ['tv', messages.tabTv],
              ] as [Filter, MessageDescriptor][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFilter(key);
                  setExpanded(false);
                }}
                className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                  filter === key
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {intl.formatMessage(label)}
              </button>
            ))}
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="ml-auto flex-shrink-0 text-[11px] text-indigo-400 hover:text-indigo-300"
            >
              {intl.formatMessage(messages.viewAll)}
            </button>
          )}
        </div>

        {!data && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}
        {data && items.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500">
            {intl.formatMessage(messages.empty)}
          </div>
        )}

        {top.length > 0 && (
          <div className="mt-4 flex items-end justify-center gap-2 sm:gap-3">
            {/* 经典领奖台布局：第二名居左、第一名居中、第三名居右 */}
            {(
              [
                { item: top[1], rank: 2 },
                { item: top[0], rank: 1 },
                { item: top[2], rank: 3 },
              ] as { item: WatchedItem | undefined; rank: 1 | 2 | 3 }[]
            )
              .filter(
                (entry): entry is { item: WatchedItem; rank: 1 | 2 | 3 } =>
                  entry.item !== undefined
              )
              .map(({ item, rank }) => (
                <PodiumCard
                  key={`${item.mediaType}-${item.tmdbId}`}
                  rank={rank}
                  item={item}
                  maxCount={maxCount}
                />
              ))}
          </div>
        )}

        {rest.length > 0 && expanded && (
          <div className="mt-3 border-t border-dashed border-gray-700 pt-2">
            {rest.map((item, i) => (
              <ListRow
                key={`${item.mediaType}-${item.tmdbId}`}
                rank={i + 4}
                item={item}
                maxCount={maxCount}
              />
            ))}
          </div>
        )}

        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 w-full rounded-lg bg-gray-800 px-4 py-2 text-xs font-medium text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700"
          >
            {expanded
              ? intl.formatMessage(messages.collapse)
              : intl.formatMessage(messages.expandMore, { count: rest.length })}
          </button>
        )}

        {showAll && (
          <Transition
            as={Fragment}
            appear
            show
            enter="transition-opacity duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Modal
              title={intl.formatMessage(messages.title)}
              onCancel={() => setShowAll(false)}
              backgroundClickable
              cancelText={intl.formatMessage(messages.close)}
            >
              <div className="max-h-[70vh] overflow-y-auto">
                <div className="text-xs text-gray-500">
                  {intl.formatMessage(messages.watchCount, {
                    count: allItems[0]?.watchCount ?? 0,
                    watchers: allItems[0]?.watchers ?? 0,
                  })}
                </div>
                <div className="mt-2 space-y-1">
                  {!allData && <LoadingSpinner />}
                  {allItems.map((item, i) => (
                    <ListRow
                      key={`${item.mediaType}-${item.tmdbId}`}
                      rank={i + 1}
                      item={item}
                      maxCount={allItems[0]?.watchCount ?? 1}
                    />
                  ))}
                </div>
              </div>
            </Modal>
          </Transition>
        )}

        {/* 更新速递：MoviePilot 订阅中影片的更新动态（仅本人可见） */}
        <SubscriptionFeed />
      </div>
    </div>
  );
};

export default ActivityLeaderboard;
