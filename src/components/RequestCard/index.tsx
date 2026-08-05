import Spinner from '@app/assets/spinner.svg';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import UserAvatar from '@app/components/Common/UserAvatar';
import RequestModal from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import useDeepLinks from '@app/hooks/useDeepLinks';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isMovie } from '@app/utils/media';
import { refreshIntervalHelper } from '@app/utils/refreshIntervalHelper';
import { revalidateRequests } from '@app/utils/revalidateRequests';
import { withProperties } from '@app/utils/typeHelpers';
import {
  ArrowPathIcon,
  CheckIcon,
  HeartIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { RequestVotesResponse } from '@server/interfaces/api/voteInterfaces';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import Link from 'next/link';
import { memo, useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.RequestCard', {
  seasons: '{seasonCount, plural, one {Season} other {Seasons}}',
  failedretry: 'Something went wrong while retrying the request.',
  failedmodify: 'Something went wrong while modifying the request.',
  mediaerror: '{mediaType} Not Found',
  tmdbid: 'TMDB ID',
  tvdbid: 'TheTVDB ID',
  approverequest: 'Approve Request',
  declinerequest: 'Decline Request',
  editrequest: 'Edit Request',
  cancelrequest: 'Cancel Request',
  deleterequest: 'Delete Request',
  unknowntitle: 'Unknown Title',
  vote: 'I Also Want This',
  voted: 'Remove My Support',
  votesupport: 'Show support for this request',
});

const RequestCardPlaceholder = () => {
  return (
    <div className="relative w-72 animate-pulse rounded-xl bg-gray-700 p-4 sm:w-96">
      <div className="w-20 sm:w-28">
        <div className="w-full" style={{ paddingBottom: '150%' }} />
      </div>
    </div>
  );
};

interface RequestCardErrorProps {
  requestData?: NonFunctionProperties<MediaRequest>;
}

const RequestCardError = ({ requestData }: RequestCardErrorProps) => {
  const { hasPermission } = useUser();
  const intl = useIntl();

  const { mediaUrl } = useDeepLinks({
    mediaUrl: requestData?.media?.mediaUrl,
  });

  const deleteRequest = async () => {
    await axios.delete(`/api/v1/media/${requestData?.media.id}`);
    mutate('/api/v1/media?filter=allavailable&take=20&sort=mediaAdded');
    revalidateRequests();
  };

  return (
    <div
      className="relative flex w-72 overflow-hidden rounded-xl bg-gray-800 p-4 text-gray-400 shadow ring-1 ring-red-500 sm:w-96"
      data-testid="request-card"
    >
      <div className="w-20 sm:w-28">
        <div className="w-full" style={{ paddingBottom: '150%' }}>
          <div className="absolute inset-0 z-10 flex min-w-0 flex-1 flex-col p-4">
            <div
              className="whitespace-normal text-base font-bold text-white sm:text-lg"
              data-testid="request-card-title"
            >
              {intl.formatMessage(messages.mediaerror, {
                mediaType: intl.formatMessage(
                  requestData?.type
                    ? requestData?.type === 'movie'
                      ? globalMessages.movie
                      : globalMessages.tvshow
                    : globalMessages.request
                ),
              })}
            </div>
            {requestData && (
              <>
                {hasPermission(
                  [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                  { type: 'or' }
                ) && (
                  <div className="card-field !hidden sm:!block">
                    <Link
                      href={`/users/${requestData.requestedBy.id}`}
                      className="group flex items-center"
                    >
                      <UserAvatar
                        user={requestData.requestedBy}
                        size="sm"
                        className="mr-1"
                      />
                      <span className="truncate group-hover:underline">
                        {requestData.requestedBy.displayName}
                      </span>
                    </Link>
                  </div>
                )}
                <div className="mt-2 flex items-center text-sm sm:mt-1">
                  <span className="mr-2 hidden font-bold sm:block">
                    {intl.formatMessage(globalMessages.status)}
                  </span>
                  {requestData.status === MediaRequestStatus.DECLINED ||
                  requestData.status === MediaRequestStatus.FAILED ? (
                    <Badge badgeType="danger">
                      {requestData.status === MediaRequestStatus.DECLINED
                        ? intl.formatMessage(globalMessages.declined)
                        : intl.formatMessage(globalMessages.failed)}
                    </Badge>
                  ) : (
                    <StatusBadge
                      status={requestData.media.status}
                      downloadItem={requestData.media.downloadStatus}
                      title={intl.formatMessage(messages.unknowntitle)}
                      inProgress={
                        (requestData.media.downloadStatus ?? []).length > 0
                      }
                      mediaType={requestData.type}
                      mediaUrl={mediaUrl}
                      serviceUrl={requestData.media.serviceUrl}
                    />
                  )}
                </div>
              </>
            )}
            <div className="flex flex-1 items-end space-x-2">
              {hasPermission(Permission.MANAGE_REQUESTS) &&
                requestData?.media.id && (
                  <>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="mt-4 hidden sm:block"
                      onClick={() => deleteRequest()}
                    >
                      <TrashIcon />
                      <span>{intl.formatMessage(globalMessages.delete)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.deleterequest)}
                    >
                      <Button
                        buttonType="danger"
                        buttonSize="sm"
                        className="mt-4 sm:hidden"
                        onClick={() => deleteRequest()}
                      >
                        <TrashIcon />
                      </Button>
                    </Tooltip>
                  </>
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface RequestCardProps {
  request: NonFunctionProperties<MediaRequest>;
  onTitleData?: (requestId: number, title: MovieDetails | TvDetails) => void;
  /** 隐藏声援（点赞）区域：用于发现页最新请求等强调影片的卡片场景 */
  hideVote?: boolean;
}

const RequestCard = ({
  request,
  onTitleData,
  hideVote = false,
}: RequestCardProps) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
  });
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const [isRetrying, setRetrying] = useState(false);
  const [updatingType, setUpdatingType] = useState<
    'approve' | 'decline' | null
  >(null);
  const [isVoting, setIsVoting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const url =
    request.type === 'movie'
      ? `/api/v1/movie/${request.media.tmdbId}`
      : `/api/v1/tv/${request.media.tmdbId}`;

  const { data: title, error } = useSWR<MovieDetails | TvDetails>(
    inView ? `${url}` : null
  );
  const {
    data: requestData,
    error: requestError,
    mutate: revalidate,
  } = useSWR<NonFunctionProperties<MediaRequest>>(
    `/api/v1/request/${request.id}`,
    {
      fallbackData: request,
      refreshInterval: refreshIntervalHelper(
        {
          downloadStatus: request.media.downloadStatus,
        },
        15000
      ),
    }
  );

  const { mediaUrl } = useDeepLinks({
    mediaUrl: requestData?.media?.mediaUrl,
  });

  // 点赞信息：仅当请求人是本人或具备查看请求权限时拉取完整点赞列表（含头像）
  const canViewVoters =
    requestData &&
    (requestData.requestedBy.id === user?.id ||
      hasPermission([Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW], {
        type: 'or',
      }));
  const { data: votesData, mutate: revalidateVotes } =
    useSWR<RequestVotesResponse>(
      canViewVoters ? `/api/v1/request/${request.id}/votes` : null
    );

  const toggleVote = async () => {
    if (!requestData) {
      return;
    }
    setIsVoting(true);

    try {
      if (requestData.userVoted) {
        await axios.delete(`/api/v1/request/${request.id}/vote`);
      } else {
        await axios.post(`/api/v1/request/${request.id}/vote`);
      }
      revalidate();
      revalidateVotes();
    } catch {
      addToast(intl.formatMessage(messages.failedmodify), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsVoting(false);
    }
  };

  const modifyRequest = async (type: 'approve' | 'decline') => {
    setUpdatingType(type);
    const newStatus =
      type === 'approve'
        ? MediaRequestStatus.APPROVED
        : MediaRequestStatus.DECLINED;
    const optimisticRequest = requestData
      ? { ...requestData, status: newStatus }
      : undefined;

    try {
      if (optimisticRequest) {
        await revalidate(
          async () => {
            await axios.post(`/api/v1/request/${request.id}/${type}`);
            return optimisticRequest;
          },
          {
            optimisticData: optimisticRequest,
            rollbackOnError: true,
          }
        );
      } else {
        await axios.post(`/api/v1/request/${request.id}/${type}`);
      }
      revalidateRequests();
    } catch {
      addToast(intl.formatMessage(messages.failedmodify), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setUpdatingType(null);
    }
  };

  const deleteRequest = async () => {
    await axios.delete(`/api/v1/request/${request.id}`);
    revalidateRequests();
  };

  const retryRequest = async () => {
    setRetrying(true);

    try {
      const response = await axios.post(`/api/v1/request/${request.id}/retry`);

      if (response) {
        revalidate();
      }
    } catch {
      addToast(intl.formatMessage(messages.failedretry), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (title && onTitleData) {
      onTitleData(request.id, title);
    }
  }, [title, onTitleData, request]);

  if (!title && !error) {
    return (
      <div ref={ref}>
        <RequestCardPlaceholder />
      </div>
    );
  }

  if (!requestData && !requestError) {
    return <RequestCardError />;
  }

  if (!title || !requestData) {
    return <RequestCardError requestData={requestData} />;
  }

  return (
    <>
      <RequestModal
        show={showEditModal}
        tmdbId={request.media.tmdbId}
        type={request.type}
        editRequest={request}
        onCancel={() => setShowEditModal(false)}
        onComplete={() => {
          revalidate();
          setShowEditModal(false);
        }}
      />
      <div
        className="relative flex w-72 overflow-hidden rounded-xl bg-gray-800 bg-cover bg-center p-4 text-gray-400 shadow ring-1 ring-gray-700 sm:w-96"
        data-testid="request-card"
      >
        {title.backdropPath && (
          <div className="absolute inset-0 z-0">
            <CachedImage
              type="tmdb"
              alt=""
              src={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${title.backdropPath}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, rgba(17, 24, 39, 0.47) 0%, rgba(17, 24, 39, 1) 75%)',
              }}
            />
          </div>
        )}
        <div
          className="relative z-10 flex min-w-0 flex-1 flex-col pr-4"
          data-testid="request-card-title"
        >
          <div className="hidden text-xs font-medium text-white sm:flex">
            {(isMovie(title) ? title.releaseDate : title.firstAirDate)?.slice(
              0,
              4
            )}
          </div>
          <Link
            href={
              request.type === 'movie'
                ? `/movie/${requestData.media.tmdbId}`
                : `/tv/${requestData.media.tmdbId}`
            }
            className="overflow-hidden overflow-ellipsis whitespace-nowrap text-base font-bold text-white hover:underline sm:text-lg"
          >
            {isMovie(title) ? title.title : title.name}
          </Link>
          {hasPermission(
            [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
            { type: 'or' }
          ) && (
            <div className="card-field">
              <Link
                href={`/users/${requestData.requestedBy.id}`}
                className="group flex items-center"
              >
                <UserAvatar
                  user={requestData.requestedBy}
                  size="sm"
                  className="mr-1"
                />
                <span className="truncate font-semibold group-hover:text-white group-hover:underline">
                  {requestData.requestedBy.displayName}
                </span>
              </Link>
            </div>
          )}
          {!isMovie(title) && request.seasons.length > 0 && (
            <div className="my-0.5 hidden items-center text-sm sm:my-1 sm:flex">
              <span className="mr-2 font-bold">
                {intl.formatMessage(messages.seasons, {
                  seasonCount: request.seasons.length,
                })}
              </span>
              <div className="hide-scrollbar overflow-x-scroll">
                {request.seasons.map((season) => (
                  <span key={`season-${season.id}`} className="mr-2">
                    <Badge>
                      {season.seasonNumber === 0
                        ? intl.formatMessage(globalMessages.specials)
                        : season.seasonNumber}
                    </Badge>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center text-sm sm:mt-1">
            <span className="mr-2 hidden font-bold sm:block">
              {intl.formatMessage(globalMessages.status)}
            </span>
            {requestData.status === MediaRequestStatus.DECLINED ? (
              <Badge badgeType="danger">
                {intl.formatMessage(globalMessages.declined)}
              </Badge>
            ) : requestData.status === MediaRequestStatus.FAILED ? (
              <Badge
                badgeType="danger"
                href={`/${requestData.type}/${requestData.media.tmdbId}?manage=1`}
              >
                {intl.formatMessage(globalMessages.failed)}
              </Badge>
            ) : requestData.status === MediaRequestStatus.PENDING &&
              requestData.media.status === MediaStatus.DELETED ? (
              <Badge
                badgeType="warning"
                href={`/${requestData.type}/${requestData.media.tmdbId}?manage=1`}
              >
                {intl.formatMessage(globalMessages.pending)}
              </Badge>
            ) : (
              <StatusBadge
                status={requestData.media.status}
                downloadItem={requestData.media.downloadStatus}
                title={isMovie(title) ? title.title : title.name}
                inProgress={(requestData.media.downloadStatus ?? []).length > 0}
                tmdbId={requestData.media.tmdbId}
                mediaType={requestData.type}
                mediaUrl={mediaUrl}
                serviceUrl={requestData.media.serviceUrl}
              />
            )}
          </div>
          {!hideVote &&
            requestData.requestedBy.id !== user?.id &&
            hasPermission(Permission.VOTE) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:mt-1">
                <Button
                  buttonType={requestData.userVoted ? 'primary' : 'ghost'}
                  buttonSize="sm"
                  disabled={isVoting}
                  onClick={() => toggleVote()}
                  className="!px-2 !py-1"
                >
                  <HeartIcon className="h-4 w-4" />
                  <span className="ml-1.5">
                    {requestData.userVoted
                      ? intl.formatMessage(messages.voted)
                      : intl.formatMessage(messages.vote)}
                  </span>
                </Button>
                {!!(requestData.voteCount ?? 0) && (
                  <span className="text-sm text-gray-400">
                    {requestData.voteCount}
                  </span>
                )}
                {!!votesData?.results.length && (
                  <div className="flex -space-x-2">
                    {votesData.results.slice(0, 3).map((voter) => (
                      <Tooltip
                        content={voter.displayName}
                        key={`vote-avatar-${voter.id}`}
                      >
                        <UserAvatar
                          user={voter}
                          size="sm"
                          className="ring-2 ring-gray-800"
                        />
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            )}
          <div className="flex flex-1 items-end space-x-2">
            {requestData.status === MediaRequestStatus.FAILED &&
              hasPermission(Permission.MANAGE_REQUESTS) && (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  disabled={isRetrying}
                  onClick={() => retryRequest()}
                >
                  <ArrowPathIcon
                    className={isRetrying ? 'animate-spin' : ''}
                    style={{ marginRight: '0', animationDirection: 'reverse' }}
                  />
                  <span className="ml-1.5 hidden sm:block">
                    {intl.formatMessage(globalMessages.retry)}
                  </span>
                </Button>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              hasPermission(Permission.MANAGE_REQUESTS) && (
                <>
                  <div>
                    <Button
                      buttonType="success"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => modifyRequest('approve')}
                      disabled={updatingType !== null}
                    >
                      {updatingType === 'approve' ? <Spinner /> : <CheckIcon />}
                      <span>{intl.formatMessage(globalMessages.approve)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.approverequest)}
                    >
                      <Button
                        buttonType="success"
                        buttonSize="sm"
                        className="sm:hidden"
                        onClick={() => modifyRequest('approve')}
                        disabled={updatingType !== null}
                      >
                        {updatingType === 'approve' ? (
                          <Spinner />
                        ) : (
                          <CheckIcon />
                        )}
                      </Button>
                    </Tooltip>
                  </div>
                  <div>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => modifyRequest('decline')}
                      disabled={updatingType !== null}
                    >
                      {updatingType === 'decline' ? <Spinner /> : <XMarkIcon />}
                      <span>{intl.formatMessage(globalMessages.decline)}</span>
                    </Button>
                    <Tooltip
                      content={intl.formatMessage(messages.declinerequest)}
                    >
                      <Button
                        buttonType="danger"
                        buttonSize="sm"
                        className="sm:hidden"
                        onClick={() => modifyRequest('decline')}
                        disabled={updatingType !== null}
                      >
                        {updatingType === 'decline' ? (
                          <Spinner />
                        ) : (
                          <XMarkIcon />
                        )}
                      </Button>
                    </Tooltip>
                  </div>
                </>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              !hasPermission(Permission.MANAGE_REQUESTS) &&
              requestData.requestedBy.id === user?.id &&
              (requestData.type === 'tv' ||
                hasPermission(Permission.REQUEST_ADVANCED)) && (
                <div>
                  {!hasPermission(Permission.MANAGE_REQUESTS) && (
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      className="hidden sm:block"
                      onClick={() => setShowEditModal(true)}
                      disabled={updatingType !== null}
                    >
                      <PencilIcon />
                      <span>{intl.formatMessage(globalMessages.edit)}</span>
                    </Button>
                  )}
                  <Tooltip content={intl.formatMessage(messages.editrequest)}>
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      className="sm:hidden"
                      onClick={() => setShowEditModal(true)}
                      disabled={updatingType !== null}
                    >
                      <PencilIcon />
                    </Button>
                  </Tooltip>
                </div>
              )}
            {requestData.status === MediaRequestStatus.PENDING &&
              !hasPermission(Permission.MANAGE_REQUESTS) &&
              requestData.requestedBy.id === user?.id && (
                <div>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    className="hidden sm:block"
                    onClick={() => deleteRequest()}
                  >
                    <XMarkIcon />
                    <span>{intl.formatMessage(globalMessages.cancel)}</span>
                  </Button>
                  <Tooltip content={intl.formatMessage(messages.cancelrequest)}>
                    <Button
                      buttonType="danger"
                      buttonSize="sm"
                      className="sm:hidden"
                      onClick={() => deleteRequest()}
                    >
                      <XMarkIcon />
                    </Button>
                  </Tooltip>
                </div>
              )}
          </div>
        </div>
        <Link
          href={
            request.type === 'movie'
              ? `/movie/${requestData.media.tmdbId}`
              : `/tv/${requestData.media.tmdbId}`
          }
          className="w-20 flex-shrink-0 scale-100 transform-gpu cursor-pointer overflow-hidden rounded-md shadow-sm transition duration-300 hover:scale-105 hover:shadow-md sm:w-28"
        >
          <CachedImage
            type="tmdb"
            src={
              title.posterPath
                ? `https://image.tmdb.org/t/p/w600_and_h900_bestv2${title.posterPath}`
                : '/images/sinerr_poster_not_found.png'
            }
            alt=""
            sizes="100vw"
            style={{ width: '100%', height: 'auto' }}
            width={600}
            height={900}
          />
        </Link>
      </div>
    </>
  );
};

export default withProperties(memo(RequestCard), {
  Placeholder: RequestCardPlaceholder,
});
