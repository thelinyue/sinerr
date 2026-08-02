import BlocklistBlock from '@app/components/BlocklistBlock';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import SlideOver from '@app/components/Common/SlideOver';
import Tooltip from '@app/components/Common/Tooltip';
import DownloadBlock from '@app/components/DownloadBlock';
import IssueBlock from '@app/components/IssueBlock';
import RequestBlock from '@app/components/RequestBlock';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Bars4Icon, ServerIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, DocumentMinusIcon } from '@heroicons/react/24/solid';
import { IssueStatus } from '@server/constants/issue';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import axios from 'axios';
import { useIntl } from 'react-intl';

interface DownloadingItem {
  title: string;
  status: string;
  size: number;
  sizeLeft: number;
  estimatedCompletionTime: string;
  downloadId: string;
  externalId: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
  };
}

const filterDuplicateDownloads = (
  items: DownloadingItem[] = []
): DownloadingItem[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.downloadId)) return false;
    seen.add(item.downloadId);
    return true;
  });
};

const messages = defineMessages('components.ManageSlideOver', {
  manageModalTitle: 'Manage {mediaType}',
  manageModalIssues: 'Open Issues',
  manageModalRequests: 'Requests',
  manageModalMedia: 'Media',
  manageModalAdvanced: 'Advanced',
  manageModalNoRequests: 'No requests.',
  manageModalClearMedia: 'Clear Data',
  manageModalClearMediaWarning:
    '* This will irreversibly remove all data for this {mediaType}, including any requests. If this item exists in your {mediaServerName} library, the media information will be recreated during the next scan.',
  manageModalRemoveMediaWarning:
    '* This will irreversibly remove this {mediaType} from {arr}, including all files.',
  openarr: 'Open in {arr}',
  removearr: 'Remove from {arr}',
  clearmediadataerror: 'Something went wrong while clearing the media data.',
  removemediaerror: 'Something went wrong while removing the media.',
  downloadstatus: 'Downloads',
  markavailable: 'Mark as Available',
  markallseasonsavailable: 'Mark All Seasons as Available',
  opentautulli: 'Open in Tautulli',
  movie: 'movie',
  tvshow: 'series',
});

const isMovie = (movie: MovieDetails | TvDetails): movie is MovieDetails => {
  return (movie as MovieDetails).title !== undefined;
};

interface ManageSlideOverProps {
  show?: boolean;
  onClose: () => void;
  revalidate: () => void;
}

interface ManageSlideOverMovieProps extends ManageSlideOverProps {
  mediaType: 'movie';
  data: MovieDetails;
}

interface ManageSlideOverTvProps extends ManageSlideOverProps {
  mediaType: 'tv';
  data: TvDetails;
}

const ManageSlideOver = ({
  show,
  mediaType,
  onClose,
  data,
  revalidate,
}: ManageSlideOverMovieProps | ManageSlideOverTvProps) => {
  const { hasPermission } = useUser();
  const intl = useIntl();
  const { addToast } = useToasts();
  const settings = useSettings();

  const deleteMedia = async () => {
    if (data.mediaInfo) {
      try {
        await axios.delete(`/api/v1/media/${data.mediaInfo.id}`);
        revalidate();
        onClose();
      } catch {
        addToast(intl.formatMessage(messages.clearmediadataerror), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    }
  };

  const markAvailable = async () => {
    if (data.mediaInfo) {
      await axios.post(`/api/v1/media/${data.mediaInfo?.id}/available`, {
        ...(mediaType === 'tv' && {
          seasons: data.seasons.filter((season) => season.seasonNumber !== 0),
        }),
      });
      revalidate();
    }
  };

  const requests =
    data.mediaInfo?.requests?.filter(
      (request) => request.status !== MediaRequestStatus.DECLINED
    ) ?? [];

  const openIssues =
    data.mediaInfo?.issues?.filter(
      (issue) => issue.status === IssueStatus.OPEN
    ) ?? [];

  return (
    <SlideOver
      show={show}
      title={intl.formatMessage(messages.manageModalTitle, {
        mediaType: intl.formatMessage(
          mediaType === 'movie' ? globalMessages.movie : globalMessages.tvshow
        ),
      })}
      onClose={() => onClose()}
      subText={isMovie(data) ? data.title : data.name}
    >
      <div className="space-y-6">
        {(data?.mediaInfo?.downloadStatus ?? []).length > 0 && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(messages.downloadstatus)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <ul>
                {filterDuplicateDownloads(data.mediaInfo?.downloadStatus).map(
                  (status, index) => (
                    <Tooltip
                      key={`dl-status-${status.externalId}-${index}`}
                      content={status.title}
                    >
                      <li className="border-b border-gray-700 last:border-b-0">
                        <DownloadBlock downloadItem={status} />
                      </li>
                    </Tooltip>
                  )
                )}
              </ul>
            </div>
          </div>
        )}
        {hasPermission([Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES], {
          type: 'or',
        }) &&
          openIssues.length > 0 && (
            <div>
              <h3 className="mb-2 text-xl font-bold">
                {intl.formatMessage(messages.manageModalIssues)}
              </h3>
              <div className="overflow-hidden rounded-md border border-gray-700 shadow">
                <ul>
                  {openIssues.map((issue) => (
                    <li
                      key={`manage-issue-${issue.id}`}
                      className="border-b border-gray-700 last:border-b-0"
                    >
                      <IssueBlock issue={issue} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        {requests.length > 0 && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(messages.manageModalRequests)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <ul>
                {requests.map((request) => (
                  <li
                    key={`manage-request-${request.id}`}
                    className="border-b border-gray-700 last:border-b-0"
                  >
                    <RequestBlock
                      request={request}
                      onUpdate={() => revalidate()}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {data.mediaInfo?.status === MediaStatus.BLOCKLISTED && (
          <div>
            <h3 className="mb-2 text-xl font-bold">
              {intl.formatMessage(globalMessages.blocklist)}
            </h3>
            <div className="overflow-hidden rounded-md border border-gray-700 shadow">
              <BlocklistBlock
                tmdbId={data.mediaInfo.tmdbId}
                mediaType={data.mediaInfo.mediaType}
                onUpdate={() => revalidate()}
                onDelete={() => onClose()}
              />
            </div>
          </div>
        )}
        {hasPermission(Permission.ADMIN) &&
          (data.mediaInfo?.serviceUrl || data.mediaInfo?.tautulliUrl) && (
            <div>
              <h3 className="mb-2 text-xl font-bold">
                {intl.formatMessage(messages.manageModalMedia)}
              </h3>
              <div className="space-y-2">
                {data.mediaInfo?.tautulliUrl && (
                  <a
                    href={data.mediaInfo.tautulliUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button buttonType="ghost" className="w-full">
                      <Bars4Icon />
                      <span>{intl.formatMessage(messages.opentautulli)}</span>
                    </Button>
                  </a>
                )}
                {data.mediaInfo?.serviceUrl && (
                  <a
                    href={data?.mediaInfo?.serviceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    <Button buttonType="ghost" className="w-full">
                      <ServerIcon />
                      <span>
                        {intl.formatMessage(messages.openarr, {
                          arr: 'MoviePilot',
                        })}
                      </span>
                    </Button>
                  </a>
                )}
              </div>
            </div>
          )}
        {hasPermission(Permission.ADMIN) &&
          data?.mediaInfo &&
          data.mediaInfo.status !== MediaStatus.BLOCKLISTED && (
            <div>
              <h3 className="mb-2 text-xl font-bold">
                {intl.formatMessage(messages.manageModalAdvanced)}
              </h3>
              <div className="space-y-2">
                {data?.mediaInfo.status !== MediaStatus.AVAILABLE && (
                  <Button
                    onClick={() => markAvailable()}
                    className="w-full"
                    buttonType="success"
                  >
                    <CheckCircleIcon />
                    <span>
                      {intl.formatMessage(
                        mediaType === 'movie'
                          ? messages.markavailable
                          : messages.markallseasonsavailable
                      )}
                    </span>
                  </Button>
                )}
                <div>
                  <ConfirmButton
                    onClick={() => deleteMedia()}
                    confirmText={intl.formatMessage(globalMessages.areyousure)}
                    className="w-full"
                  >
                    <DocumentMinusIcon />
                    <span>
                      {intl.formatMessage(messages.manageModalClearMedia)}
                    </span>
                  </ConfirmButton>
                  <div className="mt-2 text-xs text-gray-400">
                    {intl.formatMessage(messages.manageModalClearMediaWarning, {
                      mediaType: intl.formatMessage(
                        mediaType === 'movie' ? messages.movie : messages.tvshow
                      ),
                      mediaServerName:
                        settings.currentSettings.mediaServerType ===
                        MediaServerType.EMBY
                          ? 'Emby'
                          : 'Jellyfin',
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </SlideOver>
  );
};

export default ManageSlideOver;
