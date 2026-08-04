import Badge from '@app/components/Common/Badge';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

interface MoviePilotStatusResponse {
  configured: boolean;
  status?: Record<string, unknown>;
  error?: boolean;
}

const messages = defineMessages('components.MoviePilotStatus', {
  subscribed: 'Subscribed',
  completed: 'Completed',
  paused: 'Paused',
  label: 'MoviePilot',
});

const MoviePilotStatus = ({
  tmdbId,
  mediaType,
}: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}) => {
  const intl = useIntl();
  const { data } = useSWR<MoviePilotStatusResponse>(
    `/api/v1/service/moviepilot/status?tmdbId=${tmdbId}&mediaType=${mediaType}`
  );

  if (!data?.configured || data.error) {
    return null;
  }

  const status = data.status ?? {};
  const state = String(status.state ?? '').toUpperCase();
  const totalEpisode = Number(status.total_episode ?? 0);
  const completedEpisode = Number(status.completed_episode ?? 0);

  let label = intl.formatMessage(messages.subscribed);
  let badgeType: 'default' | 'primary' | 'success' | 'warning' = 'default';

  // 订阅对象状态：S-已完成，R-订阅中，P-暂停（来自 MoviePilot Subscribe.state）
  if (state === 'S' || (totalEpisode > 0 && completedEpisode >= totalEpisode)) {
    label = intl.formatMessage(messages.completed);
    badgeType = 'success';
  } else if (state === 'P') {
    label = intl.formatMessage(messages.paused);
    badgeType = 'warning';
  } else {
    // 部分集已下但未完成、或仅处于订阅态，统一显示「订阅中」
    label = intl.formatMessage(messages.subscribed);
    badgeType = 'default';
  }

  return (
    <Badge badgeType={badgeType}>
      {intl.formatMessage(messages.label)}: {label}
    </Badge>
  );
};

export default MoviePilotStatus;
