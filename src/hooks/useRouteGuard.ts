import { useRouter } from 'next/router';
import { useEffect } from 'react';
import type { Permission, PermissionCheckOptions } from './useUser';
import { useUser } from './useUser';

const useRouteGuard = (
  permission: Permission | Permission[],
  options?: PermissionCheckOptions
): void => {
  const router = useRouter();
  const { user, hasPermission, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    if (!user || !hasPermission(permission, options)) {
      router.push('/');
    }
  }, [user, loading, permission, router, hasPermission, options]);
};

export default useRouteGuard;
