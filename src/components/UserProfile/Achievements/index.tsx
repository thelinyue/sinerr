import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  HeartIcon,
  ShieldCheckIcon,
  StarIcon,
  TicketIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid';
import type { Achievement } from '@server/interfaces/api/userInterfaces';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.Achievements', {
  achievements: 'Achievements',
  requester10: 'First Steps',
  requester10Description: 'Submit 10 requests',
  requester50: 'Power User',
  requester50Description: 'Submit 50 requests',
  requester100: 'Curator',
  requester100Description: 'Submit 100 requests',
  voted5: 'Supportive',
  voted5Description: 'Receive 5 votes on your requests',
  voted25: 'Fan Favorite',
  voted25Description: 'Receive 25 votes on your requests',
  helper3: 'Problem Solver',
  helper3Description: 'Report 3 issues',
});

const badgeMeta: Record<
  string,
  {
    name: MessageDescriptor;
    description: MessageDescriptor;
    icon: React.ReactNode;
  }
> = {
  requester10: {
    name: messages.requester10,
    description: messages.requester10Description,
    icon: <TicketIcon />,
  },
  requester50: {
    name: messages.requester50,
    description: messages.requester50Description,
    icon: <TicketIcon />,
  },
  requester100: {
    name: messages.requester100,
    description: messages.requester100Description,
    icon: <StarIcon />,
  },
  voted5: {
    name: messages.voted5,
    description: messages.voted5Description,
    icon: <HeartIcon />,
  },
  voted25: {
    name: messages.voted25,
    description: messages.voted25Description,
    icon: <HeartIcon />,
  },
  helper3: {
    name: messages.helper3,
    description: messages.helper3Description,
    icon: <ShieldCheckIcon />,
  },
};

const Achievements = ({ userId }: { userId: number }) => {
  const intl = useIntl();
  const { user: currentUser, hasPermission } = useUser();

  const canView =
    userId === currentUser?.id ||
    hasPermission([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS], {
      type: 'or',
    });

  const { data } = useSWR<{ results: Achievement[] }>(
    canView ? `/api/v1/user/${userId}/achievements` : null
  );

  if (!data || data.results.length === 0) {
    return null;
  }

  const earned = data.results.filter((b) => b.earned);

  return (
    <div className="mt-6">
      <div className="flex items-center space-x-2 text-gray-300">
        <TrophyIcon className="h-5 w-5" />
        <span className="font-bold">
          {intl.formatMessage(messages.achievements)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.results.map((badge) => {
          const meta = badgeMeta[badge.id];
          if (!meta) {
            return null;
          }
          return (
            <div
              key={badge.id}
              className={`flex w-full min-w-0 items-center space-x-2 rounded-lg px-3 py-2 text-sm ring-1 transition sm:w-auto ${
                badge.earned
                  ? 'bg-yellow-500/20 text-yellow-300 ring-yellow-500/50'
                  : 'bg-gray-800/50 text-gray-500 ring-gray-700'
              }`}
              data-testid={`achievement-${badge.id}`}
            >
              <span className="h-5 w-5 flex-shrink-0">{meta.icon}</span>
              <div className="min-w-0 flex-col">
                <span className="block truncate font-semibold">
                  {intl.formatMessage(meta.name)}
                </span>
                <span className="block truncate text-xs opacity-80">
                  {intl.formatMessage(meta.description)} ({badge.current}/
                  {badge.target})
                </span>
              </div>
            </div>
          );
        })}
        {earned.length === 0 && (
          <span className="text-sm text-gray-500">
            {intl.formatMessage(messages.achievements)} —{' '}
            {intl.formatMessage(messages.requester10Description)}
          </span>
        )}
      </div>
    </div>
  );
};

export default Achievements;
