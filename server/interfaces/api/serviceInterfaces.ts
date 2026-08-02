export interface ServiceCommonServer {
  id: number;
  name: string;
  isDefault: boolean;
  activeProfileId: number;
  activeDirectory: string;
  activeLanguageProfileId?: number;
  activeAnimeProfileId?: number;
  activeAnimeDirectory?: string;
  activeAnimeLanguageProfileId?: number;
  activeTags: number[];
  activeAnimeTags?: number[];
}

export interface ServiceCommonServerWithDetails {
  server: ServiceCommonServer;
  profiles: { id: number; name: string }[];
  rootFolders: {
    id: number;
    freeSpace?: number;
    path: string;
    totalSpace?: number;
  }[];
  languageProfiles?: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}
