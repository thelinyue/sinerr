import NotificationsWecom from '@app/components/Settings/Notifications/NotificationsWecom';
import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsNotifications from '@app/components/Settings/SettingsNotifications';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const NotificationsWecomPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsNotifications>
        <NotificationsWecom />
      </SettingsNotifications>
    </SettingsLayout>
  );
};

export default NotificationsWecomPage;
