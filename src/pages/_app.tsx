import Layout from '@app/components/Layout';
import LoadingBar from '@app/components/LoadingBar';
import PWAHeader from '@app/components/PWAHeader';
import ServiceWorkerSetup from '@app/components/ServiceWorkerSetup';
import StatusChecker from '@app/components/StatusChecker';
import { InteractionProvider } from '@app/context/InteractionContext';
import { LanguageContext } from '@app/context/LanguageContext';
import { SettingsProvider } from '@app/context/SettingsContext';
import { UserContext } from '@app/context/UserContext';
import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import '@app/styles/globals.css';
import { polyfillIntl } from '@app/utils/polyfillIntl';
import { getHostAndPort } from '@app/utils/urlHelper';
import '@fontsource-variable/inter';
import { MediaServerType } from '@server/constants/server';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import type { AvailableLocale } from '@server/types/languages';
import axios from 'axios';
import type { AppInitialProps, AppProps } from 'next/app';
import App from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localeCache = new Map<string, Promise<any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadLocaleData = (locale: AvailableLocale): Promise<any> => {
  const cached = localeCache.get(locale);
  if (cached) {
    return cached;
  }

  let promise: Promise<any>;
  switch (locale) {
    case 'zh-CN':
      promise = import('../i18n/locale/zh_Hans.json');
      break;
    case 'zh-TW':
      promise = import('../i18n/locale/zh_Hant.json');
      break;
    default:
      promise = import('../i18n/locale/en.json');
  }

  localeCache.set(locale, promise);
  return promise;
};

// Custom types so we can correctly type our GetInitialProps function
// with our combined user prop
// This is specific to _app.tsx. Other pages will not need to do this!
type NextAppComponentType = typeof App;
type MessagesType = Record<string, string>;

interface ExtendedAppProps extends AppProps {
  user: User | undefined;
  messages: MessagesType;
  locale: AvailableLocale;
  currentSettings: PublicSettingsResponse;
}

const CoreApp: Omit<NextAppComponentType, 'origGetInitialProps'> = ({
  Component,
  pageProps,
  router,
  user,
  messages,
  locale,
  currentSettings,
}: ExtendedAppProps) => {
  let component: React.ReactNode;
  const [loadedMessages, setMessages] = useState<MessagesType>(messages);
  const [currentLocale, setLocale] = useState<AvailableLocale>(locale);

  useEffect(() => {
    loadLocaleData(currentLocale).then(setMessages);
  }, [currentLocale]);

  const { hasPermission } = useUser();

  useEffect(() => {
    const requestsCount = async () => {
      const response = await axios.get('/api/v1/request/count');
      return response.data;
    };

    // Cast navigator to a type that includes setAppBadge and clearAppBadge
    // to avoid TypeScript errors while ensuring these methods exist before calling them.
    const newNavigator = navigator as unknown as {
      setAppBadge?: (count: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    const handleBadgeUpdate = () => {
      if ('setAppBadge' in newNavigator) {
        if (
          !router.pathname.match(/(login|setup|resetpassword)/) &&
          hasPermission(Permission.ADMIN)
        ) {
          requestsCount().then((data) => {
            if (data.pending > 0) {
              newNavigator.setAppBadge?.(data.pending);
            } else {
              newNavigator.clearAppBadge?.();
            }
          });
        } else {
          newNavigator.clearAppBadge?.();
        }
      }
    };

    handleBadgeUpdate();

    window.addEventListener('focus', handleBadgeUpdate);

    return () => {
      window.removeEventListener('focus', handleBadgeUpdate);
    };
  }, [hasPermission, router.pathname]);

  if (router.pathname.match(/(login|setup|resetpassword)/)) {
    component = <Component {...pageProps} />;
  } else {
    component = (
      <Layout>
        <Component {...pageProps} />
      </Layout>
    );
  }

  return (
    <SWRConfig
      value={{
        fetcher: (url) =>
          axios.get(url, { timeout: 15000 }).then((res) => res.data),
        fallback: {
          '/api/v1/auth/me': user,
        },
        dedupingInterval: 30000,
        focusThrottleInterval: 30000,
        revalidateOnFocus: false,
        errorRetryCount: 2,
      }}
    >
      <LanguageContext.Provider value={{ locale: currentLocale, setLocale }}>
        <IntlProvider
          locale={currentLocale}
          defaultLocale="zh-CN"
          messages={loadedMessages}
        >
          <LoadingBar />
          <SettingsProvider currentSettings={currentSettings}>
            <InteractionProvider>
              <Head>
                <title>{currentSettings.applicationTitle}</title>
                <meta
                  name="viewport"
                  content="initial-scale=1, viewport-fit=cover, width=device-width"
                />
                <PWAHeader
                  applicationTitle={currentSettings.applicationTitle}
                />
              </Head>
              <StatusChecker />
              <ServiceWorkerSetup />
              <UserContext initialUser={user}>{component}</UserContext>
              <Toaster
                position="top-right"
                toastOptions={{ duration: 4000 }}
                containerStyle={{
                  zIndex: 10000,
                  paddingTop: 'env(safe-area-inset-top)',
                }}
              />
            </InteractionProvider>
          </SettingsProvider>
        </IntlProvider>
      </LanguageContext.Provider>
    </SWRConfig>
  );
};

CoreApp.getInitialProps = async (initialProps) => {
  const { ctx, router } = initialProps;
  let user: User | undefined = undefined;
  let currentSettings: PublicSettingsResponse = {
    initialized: false,
    applicationTitle: '',
    applicationUrl: '',
    hideAvailable: false,
    hideBlocklisted: false,
    movie4kEnabled: false,
    series4kEnabled: false,
    localLogin: true,
    mediaServerLogin: true,
    discoverRegion: '',
    streamingRegion: '',
    originalLanguage: '',
    mediaServerType: MediaServerType.NOT_CONFIGURED,
    partialRequestsEnabled: true,
    enableSpecialEpisodes: false,
    cacheImages: false,
    vapidPublic: '',
    enablePushRegistration: false,
    locale: 'zh-CN',
    emailEnabled: false,
    clientDownloadUrls: [] as { name: string; url: string; icon: string }[],
    serverConnectionUrl: '',
  };

  if (ctx.res) {
    const axiosConfig = { timeout: 10000 };

    try {
      const response = await axios.get<PublicSettingsResponse>(
        `http://${getHostAndPort()}/api/v1/settings/public`,
        axiosConfig
      );

      currentSettings = response.data;

      if (!response.data.initialized) {
        if (!router.pathname.match(/(setup)/)) {
          ctx.res.writeHead(307, { Location: '/setup' });
          ctx.res.end();
        }
        return {
          pageProps: {},
          user,
          messages: {},
          locale: 'en' as AvailableLocale,
          currentSettings,
        };
      }

      try {
        const userResponse = await axios.get<User>(
          `http://${getHostAndPort()}/api/v1/auth/me`,
          {
            ...axiosConfig,
            headers:
              ctx.req && ctx.req.headers.cookie
                ? { cookie: ctx.req.headers.cookie }
                : undefined,
          }
        );
        user = userResponse.data;

        if (router.pathname.match(/(setup|login)/)) {
          ctx.res.writeHead(307, { Location: '/' });
          ctx.res.end();
          return {
            pageProps: {},
            user,
            messages: {},
            locale: 'en' as AvailableLocale,
            currentSettings,
          };
        }
      } catch {
        if (!router.pathname.match(/(login|setup|resetpassword)/)) {
          ctx.res.writeHead(307, { Location: '/login' });
          ctx.res.end();
          return {
            pageProps: {},
            user,
            messages: {},
            locale: 'en' as AvailableLocale,
            currentSettings,
          };
        }
      }
    } catch {
      if (!router.pathname.match(/(setup)/)) {
        ctx.res.writeHead(307, { Location: '/setup' });
        ctx.res.end();
        return {
          pageProps: {},
          user,
          messages: {},
          locale: 'en' as AvailableLocale,
          currentSettings,
        };
      }
    }
  }

  // Run the default getInitialProps for the main nextjs initialProps
  const appInitialProps: AppInitialProps =
    await App.getInitialProps(initialProps);

  const locale = user?.settings?.locale
    ? user.settings.locale
    : currentSettings.locale;

  const messages = await loadLocaleData(locale as AvailableLocale);
  await polyfillIntl();

  return { ...appInitialProps, user, messages, locale, currentSettings };
};

export default CoreApp;
