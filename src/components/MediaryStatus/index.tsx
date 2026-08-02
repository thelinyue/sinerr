import Badge from '@app/components/Common/Badge';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface MediaryStatusResponse {
  configured: boolean;
  status?: Record<string, unknown>;
  error?: boolean;
}

const messages = defineMessages('components.MediaryStatus', {
  downloading: 'Downloading',
  subscribed: 'Subscribed',
  completed: 'Completed',
  label: 'Mediary',
});

const MediaryStatus = ({
  tmdbId,
  mediaType,
}: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}) => {
  const intl = useIntl();
  const { data } = useSWR<MediaryStatusResponse>(
    `/api/v1/service/mediary/status?tmdbId=${tmdbId}&mediaType=${mediaType}`
  );

  if (!data?.configured || data.error) {
    return null;
  }

  const rawStatus = String(data.status?.status ?? '').toLowerCase();

  let label = intl.formatMessage(messages.subscribed);
  let badgeType: 'default' | 'primary' | 'success' = 'default';

  if (
    rawStatus.includes('complete') ||
    rawStatus.includes('done') ||
    rawStatus.includes('seeded')
  ) {
    label = intl.formatMessage(messages.completed);
    badgeType = 'success';
  } else if (rawStatus.includes('download')) {
    label = intl.formatMessage(messages.downloading);
    badgeType = 'primary';
  }

  return (
    <Badge badgeType={badgeType}>
      {intl.formatMessage(messages.label)}: {label}
    </Badge>
  );
};

export default MediaryStatus;
