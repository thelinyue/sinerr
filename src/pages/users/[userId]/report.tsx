import Report from '@app/components/UserProfile/Report';
import { Permission, useUser } from '@app/hooks/useUser';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

const UserReportPage = () => {
  const router = useRouter();
  const userId = Number(router.query.userId);
  const { user, hasPermission, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    const isSelf = user?.id === userId;
    const canView = hasPermission(
      [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
      { type: 'or' }
    );
    if (!user || (!isSelf && !canView)) {
      router.push('/');
    }
  }, [user, userId, hasPermission, loading, router]);

  return <Report />;
};

export default UserReportPage;
