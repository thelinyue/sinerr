import CachedImage from '@app/components/Common/CachedImage';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { MediaRequestStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.RequestCompactRow', {
  updatedTo: '↻ Updated to S{season}E{episode}',
  newEpisodes: '+{count}',
  failed: 'Failed',
});

interface RequestCompactRowProps {
  request: MediaRequest;
  /** 该请求对应媒体的最近更新信息（来自 following-updates） */
  update?: {
    episodeCount: number;
    newEpisodes: {
      seasonNumber: number;
      episodeNumber: number;
      addedAt: string;
    }[];
  };
}

/** 请求状态徽章（文字 + 颜色，对齐原型） */
const RequestStatusChip = ({ status }: { status: MediaRequestStatus }) => {
  const intl = useIntl();
  const map: Record<number, { label: string; cls: string }> = {
    [MediaRequestStatus.PENDING]: {
      label: intl.formatMessage(globalMessages.pending),
      cls: 'bg-amber-500/15 text-amber-400',
    },
    [MediaRequestStatus.APPROVED]: {
      label: intl.formatMessage(globalMessages.approved),
      cls: 'bg-green-500/15 text-green-400',
    },
    [MediaRequestStatus.COMPLETED]: {
      label: intl.formatMessage(globalMessages.completed),
      cls: 'bg-indigo-500/15 text-indigo-400',
    },
    [MediaRequestStatus.DECLINED]: {
      label: intl.formatMessage(globalMessages.declined),
      cls: 'bg-red-500/15 text-red-400',
    },
    [MediaRequestStatus.FAILED]: {
      label: intl.formatMessage(messages.failed),
      cls: 'bg-red-500/15 text-red-400',
    },
  };
  const entry = map[status] ?? {
    label: String(status),
    cls: 'bg-gray-500/15 text-gray-400',
  };
  return (
    <span
      className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
};

/**
 * 请求紧凑行（对齐用户详情页原型）：
 * 小海报 + 标题 + 状态徽章 + 请求时间 + 剧集更新状态行
 */
const RequestCompactRow = ({ request, update }: RequestCompactRowProps) => {
  const intl = useIntl();
  const tmdbId = request.media?.tmdbId;
  const mediaType = request.media?.mediaType ?? 'movie';
  const url =
    mediaType === 'movie' ? `/api/v1/movie/${tmdbId}` : `/api/v1/tv/${tmdbId}`;
  const { data } = useSWR<MovieDetails | TvDetails>(tmdbId ? url : null);
  const href = mediaType === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const title = data ? (isMovie(data) ? data.title : data.name) : null;

  const latest =
    update && update.newEpisodes.length > 0
      ? update.newEpisodes[update.newEpisodes.length - 1]
      : null;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/60 p-2.5 transition hover:bg-gray-700/50"
    >
      <CachedImage
        type="tmdb"
        src={
          data?.posterPath
            ? `https://image.tmdb.org/t/p/w154${data.posterPath}`
            : '/images/sinerr_poster_not_found.png'
        }
        alt=""
        className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
        width={64}
        height={96}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">
            {title ?? '\u00A0'}
          </span>
          <span className="flex-shrink-0">
            <RequestStatusChip status={request.status} />
          </span>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {intl.formatDate(request.createdAt, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </div>
        {latest && update && update.episodeCount > 0 && (
          <div className="mt-0.5 text-xs text-emerald-400">
            {intl.formatMessage(messages.updatedTo, {
              season: latest.seasonNumber,
              episode: latest.episodeNumber,
            })}
            <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px]">
              {intl.formatMessage(messages.newEpisodes, {
                count: update.episodeCount,
              })}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
};

export default RequestCompactRow;
