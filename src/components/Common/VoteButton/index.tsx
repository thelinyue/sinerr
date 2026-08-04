import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { HeartIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.VoteButton', {
  vote: '我也想看',
  voted: '已声援',
  peopleWant: '{count} 人想看',
  notAvailable: '暂无请求可声援',
});

interface VoteState {
  voteCount: number;
  userVoted: boolean;
  activeRequestId: number | null;
}

interface VoteButtonProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  showCount?: boolean;
  onVoteChange?: (state: VoteState) => void;
}

/**
 * 声援按钮（Sinerr 2.0 模块 5）
 *
 * 媒体级接口：POST/DELETE /media/:tmdbId/:mediaType/vote。
 * 详情页主入口 + 各入口复用；无 VOTE 权限或媒体无请求时不渲染。
 */
const VoteButton = ({
  tmdbId,
  mediaType,
  showCount = true,
  onVoteChange,
}: VoteButtonProps) => {
  const intl = useIntl();
  const { hasPermission, user } = useUser();

  const { data, mutate } = useSWR<VoteState>(
    hasPermission(Permission.VOTE) && user
      ? `/api/v1/media/${tmdbId}/${mediaType}/vote`
      : null
  );

  if (!data || !hasPermission(Permission.VOTE) || !user) {
    return null;
  }

  const toggleVote = async () => {
    try {
      if (data.userVoted) {
        await axios.delete(`/api/v1/media/${tmdbId}/${mediaType}/vote`);
      } else {
        await axios.post(`/api/v1/media/${tmdbId}/${mediaType}/vote`);
      }
      const next = await mutate();
      if (next) onVoteChange?.(next);
    } catch {
      // 自赞/无请求等错误由全局提示处理
    }
  };

  return (
    <button
      type="button"
      onClick={toggleVote}
      data-testid="media-vote-button"
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition ${
        data.userVoted
          ? 'bg-pink-600 text-white ring-pink-500'
          : 'bg-gray-800 text-gray-200 ring-gray-700 hover:bg-gray-700'
      }`}
    >
      <HeartIcon className="h-4 w-4" />
      <span>
        {showCount
          ? intl.formatMessage(messages.peopleWant, {
              count: data.voteCount,
            })
          : data.userVoted
            ? intl.formatMessage(messages.voted)
            : intl.formatMessage(messages.vote)}
      </span>
    </button>
  );
};

export default VoteButton;
