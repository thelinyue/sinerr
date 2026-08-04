import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Tooltip from '@app/components/Common/Tooltip';
import UserAvatar from '@app/components/Common/UserAvatar';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  CheckCircleIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import type MediaReview from '@server/entity/MediaReview';
import type { PlaybackProgressResponse } from '@server/interfaces/api/playbackInterfaces';
import type {
  MediaReviewItem,
  MediaReviewsResponse,
} from '@server/interfaces/api/reviewInterfaces';
import axios from 'axios';
import Link from 'next/link';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.MediaReviewBlock', {
  reviews: 'Reviews',
  submitreview: 'Submit Review',
  updatereview: 'Update Review',
  canceledit: 'Cancel',
  rating: 'Rating',
  reviewplaceholder: 'What did you think of this title?',
  reviewrequired: 'Please enter a review message.',
  reviewsuccess: 'Review submitted successfully.',
  reviewfailed: 'Something went wrong submitting your review.',
  deletereview: 'Delete Review',
  editreview: 'Edit Review',
  deletefailed: 'Something went wrong deleting your review.',
  edited: 'Edited',
  avgrating: 'Average: {rating} / 5',
  wholeseries: 'Whole Series',
  season: 'Season {number}',
  wholeSeason: 'Whole Season',
  episode: 'Episode {number}',
  seasonBadge: 'Season {season}',
  episodeBadge: 'S{season}E{episode}',
  watchedMovie: 'Watched',
  unwatchedMovie: 'Not watched',
  watchedSeries: 'Watched {watched}/{total} episodes ({percent}%)',
  unwatchedSeries: 'Not watched yet',
  progressCompleted: 'Watched',
  progressWatching: 'Watching S{season}E{episode}',
  progressUnwatched: 'Not watched',
  progressHidden: '',
});

/** 季信息（仅用 TvDetails 已加载的字段） */
interface SeasonOption {
  seasonNumber: number;
  episodeCount: number;
}

const isReviewAuthor = (
  review: MediaReview,
  currentUserId: number | undefined
) => review.user.id === currentUserId;

interface ReviewTarget {
  seasonNumber: number | null;
  episodeNumber: number | null;
}

const MediaReviewBlock = ({
  tmdbId,
  mediaType,
  seasons,
}: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  seasons?: SeasonOption[];
}) => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 正在编辑的短评（null = 新增模式）；编辑时锁定季/集目标（不支持改目标）
  const [editingReview, setEditingReview] = useState<MediaReviewItem | null>(
    null
  );

  // 评论目标：默认整部剧集（movie 固定为整部）
  const [target, setTarget] = useState<ReviewTarget>({
    seasonNumber: null,
    episodeNumber: null,
  });

  const isTv = mediaType === 'tv';

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (isTv && target.seasonNumber !== null) {
      params.set('seasonNumber', String(target.seasonNumber));
    }
    if (isTv && target.episodeNumber !== null) {
      params.set('episodeNumber', String(target.episodeNumber));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [isTv, target]);

  const {
    data,
    error: loadError,
    mutate,
  } = useSWR<MediaReviewsResponse>(
    `/api/v1/review/${tmdbId}/${mediaType}${query}`
  );

  // 当前用户的观看进度（来自 Playback Reporting 插件）
  const { data: playback } = useSWR<PlaybackProgressResponse>(
    user
      ? `/api/v1/user/${user.id}/media/${tmdbId}/${mediaType}/playback`
      : null
  );

  // 选中季的集数（来自 TvDetails 已加载的 seasons）
  const selectedSeason = useMemo(
    () => seasons?.find((s) => s.seasonNumber === target.seasonNumber) ?? null,
    [seasons, target.seasonNumber]
  );

  const canPost = hasPermission(Permission.REQUEST);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!message.trim()) {
      setError(intl.formatMessage(messages.reviewrequired));
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      // 编辑态锁定原短评的季/集目标（不支持改目标）
      const targetSeason = editingReview
        ? (editingReview.seasonNumber ?? null)
        : isTv
          ? target.seasonNumber
          : undefined;
      const targetEpisode = editingReview
        ? (editingReview.episodeNumber ?? null)
        : isTv
          ? target.episodeNumber
          : undefined;

      await axios.post(`/api/v1/review/${tmdbId}/${mediaType}`, {
        rating,
        message,
        seasonNumber: targetSeason,
        episodeNumber: targetEpisode,
      });
      await mutate();
      setMessage('');
      setEditingReview(null);
    } catch {
      setError(intl.formatMessage(messages.reviewfailed));
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeReview = async (reviewId: number) => {
    try {
      await axios.delete(`/api/v1/review/${reviewId}`);
      await mutate();
    } catch {
      setError(intl.formatMessage(messages.deletefailed));
    }
  };

  // 进入编辑态：回填评分/内容/目标（目标锁定）
  const startEditReview = (review: MediaReviewItem) => {
    setEditingReview(review);
    setRating(review.rating);
    setMessage(review.message);
    setTarget({
      seasonNumber: review.seasonNumber ?? null,
      episodeNumber: review.episodeNumber ?? null,
    });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingReview(null);
    setRating(5);
    setMessage('');
    setError(null);
  };

  const reviewTargetLabel = (review: MediaReview): string => {
    if (review.seasonNumber && review.episodeNumber) {
      return intl.formatMessage(messages.episodeBadge, {
        season: review.seasonNumber,
        episode: review.episodeNumber,
      });
    }
    if (review.seasonNumber) {
      return intl.formatMessage(messages.seasonBadge, {
        season: review.seasonNumber,
      });
    }
    return intl.formatMessage(messages.wholeseries);
  };

  // 评论人观看进度文案（无进度返回 null，不展示）
  const progressLabel = (review: MediaReviewItem): string | null => {
    switch (review.progress?.status) {
      case 'completed':
        return intl.formatMessage(messages.progressCompleted);
      case 'watching':
        return intl.formatMessage(messages.progressWatching, {
          season: review.progress.seasonNumber,
          episode: review.progress.episodeNumber,
        });
      case 'unwatched':
        return intl.formatMessage(messages.progressUnwatched);
      default:
        return null;
    }
  };

  if (!data && !loadError) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (loadError) {
    return null;
  }

  return (
    <div className="mb-8">
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.reviews)}</span>
        </div>
      </div>

      {playback && (
        <div className="mb-4 flex items-center space-x-2">
          {playback.played ? (
            <CheckCircleIcon className="h-5 w-5 flex-shrink-0 text-green-500" />
          ) : (
            <XCircleIcon className="h-5 w-5 flex-shrink-0 text-gray-500" />
          )}
          <span className="text-sm text-gray-300">
            {isTv
              ? playback.watchedEpisodes && playback.totalEpisodes
                ? intl.formatMessage(messages.watchedSeries, {
                    watched: playback.watchedEpisodes,
                    total: playback.totalEpisodes,
                    percent: playback.watchedPercent,
                  })
                : intl.formatMessage(messages.unwatchedSeries)
              : playback.played
                ? intl.formatMessage(messages.watchedMovie)
                : intl.formatMessage(messages.unwatchedMovie)}
          </span>
        </div>
      )}

      {isTv && !!seasons?.length && (
        <div className="mb-4 space-y-2">
          {/* 第一级：季选择 */}
          <div className="hide-scrollbar flex items-center space-x-2 overflow-x-auto">
            <button
              type="button"
              disabled={!!editingReview}
              onClick={() =>
                setTarget({ seasonNumber: null, episodeNumber: null })
              }
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                editingReview
                  ? 'cursor-not-allowed opacity-50'
                  : target.seasonNumber === null
                    ? 'bg-indigo-600 text-white ring-indigo-500'
                    : 'bg-gray-800/60 text-gray-300 ring-gray-700 hover:bg-gray-700'
              }`}
            >
              {intl.formatMessage(messages.wholeseries)}
            </button>
            {seasons
              .filter((s) => s.seasonNumber > 0)
              .map((s) => (
                <button
                  key={`season-${s.seasonNumber}`}
                  type="button"
                  disabled={!!editingReview}
                  onClick={() =>
                    setTarget({
                      seasonNumber: s.seasonNumber,
                      episodeNumber: null,
                    })
                  }
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                    editingReview
                      ? 'cursor-not-allowed opacity-50'
                      : target.seasonNumber === s.seasonNumber
                        ? 'bg-indigo-600 text-white ring-indigo-500'
                        : 'bg-gray-800/60 text-gray-300 ring-gray-700 hover:bg-gray-700'
                  }`}
                >
                  {intl.formatMessage(messages.season, {
                    number: s.seasonNumber,
                  })}
                </button>
              ))}
          </div>

          {/* 第二级：集选择（选中季时出现） */}
          {target.seasonNumber !== null && selectedSeason && (
            <div className="hide-scrollbar flex items-center space-x-2 overflow-x-auto">
              <button
                type="button"
                disabled={!!editingReview}
                onClick={() =>
                  setTarget({
                    seasonNumber: target.seasonNumber,
                    episodeNumber: null,
                  })
                }
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                  editingReview
                    ? 'cursor-not-allowed opacity-50'
                    : target.episodeNumber === null
                      ? 'bg-indigo-600 text-white ring-indigo-500'
                      : 'bg-gray-800/60 text-gray-300 ring-gray-700 hover:bg-gray-700'
                }`}
              >
                {intl.formatMessage(messages.wholeSeason)}
              </button>
              {Array.from(
                { length: selectedSeason.episodeCount },
                (_, i) => i + 1
              ).map((n) => (
                <button
                  key={`episode-${n}`}
                  type="button"
                  disabled={!!editingReview}
                  onClick={() =>
                    setTarget({
                      seasonNumber: target.seasonNumber as number,
                      episodeNumber: n,
                    })
                  }
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                    editingReview
                      ? 'cursor-not-allowed opacity-50'
                      : target.episodeNumber === n
                        ? 'bg-indigo-600 text-white ring-indigo-500'
                        : 'bg-gray-800/60 text-gray-300 ring-gray-700 hover:bg-gray-700'
                  }`}
                >
                  {intl.formatMessage(messages.episode, { number: n })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!!data?.reviewCount && (
        <div className="mb-4 flex items-center space-x-2 text-sm text-gray-400">
          <span className="flex">
            {[1, 2, 3, 4, 5].map((s) => (
              <StarIcon
                key={s}
                className={`h-4 w-4 ${
                  s <= Math.round(data?.averageRating ?? 0)
                    ? 'text-yellow-400'
                    : 'text-gray-600'
                }`}
              />
            ))}
          </span>
          <span>
            {intl.formatMessage(messages.avgrating, {
              rating: data?.averageRating ?? 0,
            })}
          </span>
        </div>
      )}

      {canPost && (
        <form
          onSubmit={submit}
          className="mb-6 rounded-lg bg-gray-800/50 p-4 shadow ring-1 ring-gray-700"
        >
          <div className="mb-3 flex items-center space-x-1">
            <span className="mr-2 text-sm text-gray-400">
              {intl.formatMessage(messages.rating)}:
            </span>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setRating(s)}
                aria-label={`${s} star`}
                className="transition-transform hover:scale-110"
              >
                <StarIcon
                  className={`h-6 w-6 ${
                    s <= rating ? 'text-yellow-400' : 'text-gray-600'
                  }`}
                />
              </button>
            ))}
          </div>
          <div className="flex flex-col items-stretch space-y-2 sm:flex-row sm:items-end sm:space-x-3 sm:space-y-0">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={intl.formatMessage(messages.reviewplaceholder)}
              maxLength={500}
              rows={2}
              className="flex-1 rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="flex items-center space-x-2">
              {editingReview && (
                <Button buttonType="ghost" type="button" onClick={cancelEdit}>
                  {intl.formatMessage(messages.canceledit)}
                </Button>
              )}
              <Button
                buttonType="primary"
                type="submit"
                disabled={isSubmitting}
              >
                {editingReview
                  ? intl.formatMessage(messages.updatereview)
                  : intl.formatMessage(messages.submitreview)}
              </Button>
            </div>
          </div>
          {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
        </form>
      )}

      {data?.results?.length ? (
        <div className="divide-y divide-gray-700/60 rounded-lg bg-gray-800/50 shadow ring-1 ring-gray-700">
          {data.results.map((review) => (
            <div
              key={`review-${review.id}`}
              className="flex items-start space-x-3 px-4 py-3"
            >
              <Link
                href={
                  review.user.id === user?.id
                    ? '/profile'
                    : `/users/${review.user.id}`
                }
                className="flex-shrink-0"
              >
                <UserAvatar user={review.user} size="md" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center space-x-2 text-sm">
                  <Link
                    href={
                      review.user.id === user?.id
                        ? '/profile'
                        : `/users/${review.user.id}`
                    }
                    className="font-semibold text-white hover:underline"
                  >
                    {review.user.displayName}
                  </Link>
                  {/* 评论人观看进度徽标 */}
                  {progressLabel(review) && (
                    <span
                      className={`flex items-center space-x-1 rounded px-1.5 py-0.5 text-xs ${
                        review.progress?.status === 'completed'
                          ? 'bg-green-500/15 text-green-400'
                          : review.progress?.status === 'watching'
                            ? 'bg-indigo-500/15 text-indigo-300'
                            : 'bg-gray-700/50 text-gray-400'
                      }`}
                    >
                      {review.progress?.status === 'completed' ? (
                        <CheckCircleIcon className="h-3 w-3" />
                      ) : null}
                      <span>{progressLabel(review)}</span>
                    </span>
                  )}
                  <span className="flex">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <StarIcon
                        key={s}
                        className={`h-3.5 w-3.5 ${
                          s <= review.rating
                            ? 'text-yellow-400'
                            : 'text-gray-600'
                        }`}
                      />
                    ))}
                  </span>
                  {isTv && (review.seasonNumber || review.episodeNumber) && (
                    <span className="rounded bg-gray-700/60 px-1.5 py-0.5 text-xs text-gray-300">
                      {reviewTargetLabel(review)}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    <FormattedRelativeTime
                      value={Math.floor(
                        (new Date(review.createdAt).getTime() - Date.now()) /
                          1000
                      )}
                      updateIntervalInSeconds={60}
                      numeric="auto"
                    />
                  </span>
                  {/* 已编辑标记：展示编辑时间 */}
                  {review.edited && (
                    <span
                      className="text-xs text-gray-500"
                      title={new Date(review.updatedAt).toLocaleString()}
                    >
                      {intl.formatMessage(messages.edited)}{' '}
                      <FormattedRelativeTime
                        value={Math.floor(
                          (new Date(review.updatedAt).getTime() - Date.now()) /
                            1000
                        )}
                        updateIntervalInSeconds={60}
                        numeric="auto"
                      />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-300">{review.message}</p>
              </div>
              {isReviewAuthor(review, user?.id) ||
              hasPermission(Permission.MANAGE_REQUESTS) ? (
                <div className="flex flex-shrink-0 items-center space-x-2">
                  {isReviewAuthor(review, user?.id) && (
                    <Tooltip content={intl.formatMessage(messages.editreview)}>
                      <button
                        onClick={() => startEditReview(review)}
                        className="text-gray-500 transition-colors hover:text-indigo-400"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content={intl.formatMessage(messages.deletereview)}>
                    <button
                      onClick={() => removeReview(review.id)}
                      className="text-gray-500 transition-colors hover:text-red-500"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {intl.formatMessage(messages.reviewplaceholder)}
        </p>
      )}
    </div>
  );
};

export default MediaReviewBlock;
