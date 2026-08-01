import type { PermissionItem } from '@app/components/PermissionOption';
import PermissionOption from '@app/components/PermissionOption';
import type { User } from '@app/hooks/useUser';
import { Permission } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';

import { useIntl } from 'react-intl';

export const messages = defineMessages('components.PermissionEdit', {
  admin: 'Admin',
  adminDescription:
    'Full administrator access. Bypasses all other permission checks.',
  users: 'Manage Users',
  usersDescription:
    'Grant permission to manage users. Users with this permission cannot modify users with or grant the Admin privilege.',
  managerequests: 'Manage Requests',
  managerequestsDescription:
    'Grant permission to manage media requests. All requests made by a user with this permission will be automatically approved.',
  request: 'Request',
  requestDescription: 'Grant permission to submit requests for media.',
  requestMovies: 'Request Movies',
  requestMoviesDescription: 'Grant permission to submit requests for movies.',
  requestTv: 'Request Series',
  requestTvDescription: 'Grant permission to submit requests for series.',
  autoapprove: 'Auto-Approve',
  autoapproveDescription: 'Grant automatic approval for all media requests.',
  autoapproveMovies: 'Auto-Approve Movies',
  autoapproveMoviesDescription: 'Grant automatic approval for movie requests.',
  autoapproveSeries: 'Auto-Approve Series',
  autoapproveSeriesDescription: 'Grant automatic approval for series requests.',
  advancedrequest: 'Advanced Requests',
  advancedrequestDescription:
    'Grant permission to modify advanced media request options.',
  viewrequests: 'View Requests',
  viewrequestsDescription:
    'Grant permission to view media requests submitted by other users.',
  manageissues: 'Manage Issues',
  manageissuesDescription: 'Grant permission to manage media issues.',
  createissues: 'Report Issues',
  createissuesDescription: 'Grant permission to report media issues.',
  viewissues: 'View Issues',
  viewissuesDescription:
    'Grant permission to view media issues reported by other users.',
  viewrecent: 'View Recently Added',
  viewrecentDescription:
    'Grant permission to view the list of recently added media.',
  manageblocklist: 'Manage Blocklist',
  manageblocklistDescription: 'Grant permission to manage blocklisted media.',
  blocklistedItems: 'Blocklist media.',
  blocklistedItemsDescription: 'Grant permission to blocklist media.',
  viewblocklistedItems: 'View blocklisted media.',
  viewblocklistedItemsDescription:
    'Grant permission to view blocklisted media.',
});

interface PermissionEditProps {
  actingUser?: User;
  currentUser?: User;
  currentPermission: number;
  onUpdate: (newPermissions: number) => void;
}

export const PermissionEdit = ({
  actingUser,
  currentUser,
  currentPermission,
  onUpdate,
}: PermissionEditProps) => {
  const intl = useIntl();

  const permissionList: PermissionItem[] = [
    {
      id: 'admin',
      name: intl.formatMessage(messages.admin),
      description: intl.formatMessage(messages.adminDescription),
      permission: Permission.ADMIN,
    },
    {
      id: 'users',
      name: intl.formatMessage(messages.users),
      description: intl.formatMessage(messages.usersDescription),
      permission: Permission.MANAGE_USERS,
    },
    {
      id: 'managerequest',
      name: intl.formatMessage(messages.managerequests),
      description: intl.formatMessage(messages.managerequestsDescription),
      permission: Permission.MANAGE_REQUESTS,
      children: [
        {
          id: 'advancedrequest',
          name: intl.formatMessage(messages.advancedrequest),
          description: intl.formatMessage(messages.advancedrequestDescription),
          permission: Permission.REQUEST_ADVANCED,
        },
        {
          id: 'viewrequests',
          name: intl.formatMessage(messages.viewrequests),
          description: intl.formatMessage(messages.viewrequestsDescription),
          permission: Permission.REQUEST_VIEW,
        },
        {
          id: 'viewrecent',
          name: intl.formatMessage(messages.viewrecent),
          description: intl.formatMessage(messages.viewrecentDescription),
          permission: Permission.RECENT_VIEW,
        },
      ],
    },
    {
      id: 'request',
      name: intl.formatMessage(messages.request),
      description: intl.formatMessage(messages.requestDescription),
      permission: Permission.REQUEST,
      children: [
        {
          id: 'request-movies',
          name: intl.formatMessage(messages.requestMovies),
          description: intl.formatMessage(messages.requestMoviesDescription),
          permission: Permission.REQUEST_MOVIE,
        },
        {
          id: 'request-tv',
          name: intl.formatMessage(messages.requestTv),
          description: intl.formatMessage(messages.requestTvDescription),
          permission: Permission.REQUEST_TV,
        },
      ],
    },
    {
      id: 'autoapprove',
      name: intl.formatMessage(messages.autoapprove),
      description: intl.formatMessage(messages.autoapproveDescription),
      permission: Permission.AUTO_APPROVE,
      requires: [{ permissions: [Permission.REQUEST] }],
      children: [
        {
          id: 'autoapprovemovies',
          name: intl.formatMessage(messages.autoapproveMovies),
          description: intl.formatMessage(
            messages.autoapproveMoviesDescription
          ),
          permission: Permission.AUTO_APPROVE_MOVIE,
          requires: [
            {
              permissions: [Permission.REQUEST, Permission.REQUEST_MOVIE],
              type: 'or',
            },
          ],
        },
        {
          id: 'autoapprovetv',
          name: intl.formatMessage(messages.autoapproveSeries),
          description: intl.formatMessage(
            messages.autoapproveSeriesDescription
          ),
          permission: Permission.AUTO_APPROVE_TV,
          requires: [
            {
              permissions: [Permission.REQUEST, Permission.REQUEST_TV],
              type: 'or',
            },
          ],
        },
      ],
    },
    {
      id: 'manageissues',
      name: intl.formatMessage(messages.manageissues),
      description: intl.formatMessage(messages.manageissuesDescription),
      permission: Permission.MANAGE_ISSUES,
      children: [
        {
          id: 'createissues',
          name: intl.formatMessage(messages.createissues),
          description: intl.formatMessage(messages.createissuesDescription),
          permission: Permission.CREATE_ISSUES,
        },
        {
          id: 'viewissues',
          name: intl.formatMessage(messages.viewissues),
          description: intl.formatMessage(messages.viewissuesDescription),
          permission: Permission.VIEW_ISSUES,
        },
      ],
    },
    {
      id: 'manageblocklist',
      name: intl.formatMessage(messages.manageblocklist),
      description: intl.formatMessage(messages.manageblocklistDescription),
      permission: Permission.MANAGE_BLOCKLIST,
      children: [
        {
          id: 'viewblocklisteditems',
          name: intl.formatMessage(messages.viewblocklistedItems),
          description: intl.formatMessage(
            messages.viewblocklistedItemsDescription
          ),
          permission: Permission.VIEW_BLOCKLIST,
        },
      ],
    },
  ];

  return (
    <>
      {permissionList.map((permissionItem) => (
        <PermissionOption
          key={`permission-option-${permissionItem.id}`}
          option={permissionItem}
          actingUser={actingUser}
          currentUser={currentUser}
          currentPermission={currentPermission}
          onUpdate={(newPermission) => onUpdate(newPermission)}
        />
      ))}
    </>
  );
};

export default PermissionEdit;
