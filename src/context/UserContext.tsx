import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import { useRouter } from 'next/dist/client/router';
import { useEffect, useRef } from 'react';

interface UserContextProps {
  initialUser?: User;
  children?: React.ReactNode;
}

export const UserContext = ({ initialUser, children }: UserContextProps) => {
  const { user, error, revalidate } = useUser({ initialData: initialUser });
  const router = useRouter();
  const routing = useRef(false);

  useEffect(() => {
    revalidate();
  }, [router.pathname, revalidate]);

  useEffect(() => {
    if (user && !error) {
      routing.current = false;
      return;
    }

    if (
      !router.pathname.match(/(setup|login|resetpassword)/) &&
      (!user || error) &&
      !routing.current
    ) {
      routing.current = true;
      router.push('/login');
    }
  }, [router, user, error]);

  return <>{children}</>;
};
