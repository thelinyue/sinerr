import Button from '@app/components/Common/Button';
import UserAvatar from '@app/components/Common/UserAvatar';
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { CogIcon, UserIcon } from '@heroicons/react/24/solid';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.UserProfile.ProfileHeader', {
  settings: 'Edit Settings',
  profile: 'View Profile',
  joindate: 'Joined {joindate}',
  userid: 'User ID: {userid}',
  adminBadge: 'Admin',
  userBadge: 'User',
});

interface ProfileHeaderProps {
  user: User;
  isSettingsPage?: boolean;
}

const ProfileHeader = ({ user, isSettingsPage }: ProfileHeaderProps) => {
  const intl = useIntl();
  const { user: loggedInUser, hasPermission } = useUser();

  const subtextItems: React.ReactNode[] = [
    intl.formatMessage(messages.joindate, {
      joindate: intl.formatDate(user.createdAt, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    }),
  ];

  if (hasPermission(Permission.MANAGE_REQUESTS)) {
    subtextItems.push(intl.formatMessage(messages.userid, { userid: user.id }));
  }

  return (
    <div className="relative z-40 mb-10 mt-6 flex items-start justify-between gap-4">
      <div className="flex items-end justify-items-end space-x-5">
        <div className="flex-shrink-0">
          <div className="relative">
            <UserAvatar
              user={user}
              size="xxl"
              className="ring-1 ring-gray-700"
            />
            <span
              className="absolute inset-0 rounded-full shadow-inner"
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="pt-1.5">
          <h1 className="mb-1 flex flex-col sm:flex-row sm:items-center">
            <Link
              href={
                user.id === loggedInUser?.id ? '/profile' : `/users/${user.id}`
              }
              className="text-overseerr text-lg font-bold hover:to-purple-200 sm:text-2xl"
            >
              {user.displayName}
            </Link>
            {user.username && user.username !== user.displayName && (
              <span className="text-sm text-gray-400 sm:ml-2 sm:text-lg">
                @{user.username}
              </span>
            )}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {user.permissions & Permission.ADMIN ? (
              <span className="inline-flex items-center rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                {intl.formatMessage(messages.adminBadge)}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-gray-700/60 px-2 py-0.5 text-[10px] font-medium text-gray-300">
                {intl.formatMessage(messages.userBadge)}
              </span>
            )}
            <p className="text-sm font-medium text-gray-400">
              {subtextItems.reduce((prev, curr) => (
                <>
                  {prev} | {curr}
                </>
              ))}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-start space-x-3">
        {(loggedInUser?.id === user.id ||
          (user.id !== 1 && hasPermission(Permission.MANAGE_USERS))) &&
        !isSettingsPage ? (
          <Link
            href={
              loggedInUser?.id === user.id
                ? `/profile/settings`
                : `/users/${user.id}/settings`
            }
          >
            <Button as="a">
              <CogIcon />
              <span>{intl.formatMessage(messages.settings)}</span>
            </Button>
          </Link>
        ) : (
          isSettingsPage && (
            <Link
              href={
                loggedInUser?.id === user.id ? `/profile` : `/users/${user.id}`
              }
            >
              <Button as="a">
                <UserIcon />
                <span>{intl.formatMessage(messages.profile)}</span>
              </Button>
            </Link>
          )
        )}
      </div>
    </div>
  );
};

export default ProfileHeader;
