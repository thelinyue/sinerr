import cacheManager from '@server/lib/cache';
import ExternalAPI from './externalapi';

class GithubAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.github.com',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('github').data,
      }
    );
  }
}

export default GithubAPI;
