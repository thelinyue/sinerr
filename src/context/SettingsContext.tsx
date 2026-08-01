import { MediaServerType } from '@server/constants/server';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import React from 'react';
import useSWR from 'swr';

export interface SettingsContextProps {
  currentSettings: PublicSettingsResponse;
  children?: React.ReactNode;
}

const defaultSettings = {
  initialized: false,
  applicationTitle: 'Sinerr',
  applicationUrl: '',
  hideAvailable: false,
  hideBlocklisted: false,
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

export const SettingsContext = React.createContext<SettingsContextProps>({
  currentSettings: defaultSettings,
});

export const SettingsProvider = ({
  children,
  currentSettings,
}: SettingsContextProps) => {
  const { data, error } = useSWR<PublicSettingsResponse>(
    '/api/v1/settings/public',
    { fallbackData: currentSettings }
  );

  let newSettings = defaultSettings;

  if (data && !error) {
    newSettings = data;
  }

  return (
    <SettingsContext.Provider value={{ currentSettings: newSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
