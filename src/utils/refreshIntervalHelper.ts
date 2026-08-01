interface DownloadingItem {
  title: string;
  status: string;
  size: number;
  sizeLeft: number;
  estimatedCompletionTime: string;
  downloadId: string;
  externalId: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
  };
}

export const refreshIntervalHelper = (
  downloadItem: {
    downloadStatus: DownloadingItem[] | undefined;
  },
  timer: number
) => {
  if ((downloadItem.downloadStatus ?? []).length > 0) {
    return timer;
  } else {
    return 0;
  }
};
