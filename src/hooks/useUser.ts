import { UserType } from '@server/constants/user';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { hasPermission, Permission } from '@server/lib/permissions';
import type { NotificationAgentKey } from '@server/lib/settings';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import type { MutatorCallback } from 'swr';
import useSWR from 'swr';

export { Permission, UserType };
export type { PermissionCheckOptions };

export interface User {
  id: number;
  warnings: string[];
  jellyfinUsername?: string | null;
  username?: string;
  displayName: string;
  email?: string | null;
  avatar: string;
  permissions: number;
  userType: number;
  createdAt: Date;
  updatedAt: Date;
  requestCount?: number;
  settings?: UserSettings;
}

type NotificationAgentTypes = Record<NotificationAgentKey, number>;

export interface UserSettings {
  discoverRegion?: string;
  streamingRegion?: string;
  originalLanguage?: string;
  locale?: string;
  notificationTypes: Partial<NotificationAgentTypes>;
}

interface UserHookResponse {
  user?: User;
  loading: boolean;
  error: string;
  revalidate: (
    data?: User | Promise<User> | MutatorCallback<User> | undefined,
    shouldRevalidate?: boolean | undefined
  ) => Promise<User | undefined>;
  hasPermission: (
    permission: Permission | Permission[],
    options?: PermissionCheckOptions
  ) => boolean;
}

export const useUser = ({
  id,
  initialData,
}: { id?: number; initialData?: User } = {}): UserHookResponse => {
  const router = useRouter();
  const isAuthPage = router.pathname
    ? /^\/(login|setup|resetpassword(?:\/|$))/.test(router.pathname)
    : false;

  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR<User>(id ? `/api/v1/user/${id}` : `/api/v1/auth/me`, {
    fallbackData: initialData,
    refreshInterval: !isAuthPage ? 60000 : 0,
    revalidateOnFocus: !isAuthPage,
    revalidateOnMount: !isAuthPage,
    revalidateOnReconnect: !isAuthPage,
    errorRetryInterval: 30000,
    shouldRetryOnError: false,
  });

  const checkPermission = useCallback(
    (
      permission: Permission | Permission[],
      options?: PermissionCheckOptions
    ): boolean => {
      return hasPermission(permission, data?.permissions ?? 0, options);
    },
    [data?.permissions]
  );

  return {
    user: data,
    loading: !data && !error,
    error,
    hasPermission: checkPermission,
    revalidate,
  };
};
