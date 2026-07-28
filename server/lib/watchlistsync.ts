import logger from '@server/logger';

class WatchlistSync {
  public async syncWatchlist() {
    logger.debug('Watchlist sync is not available (Plex removed)', {
      label: 'Watchlist Sync',
    });
  }
}

const watchlistSync = new WatchlistSync();

export default watchlistSync;
