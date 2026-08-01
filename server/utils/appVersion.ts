import logger from '@server/logger';
import { existsSync } from 'fs';
import path from 'path';

const COMMIT_TAG_PATH = path.join(__dirname, '../../committag.json');
const SEERR_VERSION_PATH = path.join(__dirname, '../../seerr-version.json');
let commitTag = 'local';
let seerrVersion = 'unknown';

if (existsSync(COMMIT_TAG_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  commitTag = require(COMMIT_TAG_PATH).commitTag;
  logger.info(`Commit Tag: ${commitTag}`);
}

if (existsSync(SEERR_VERSION_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  seerrVersion = require(SEERR_VERSION_PATH).version;
  logger.info(`Seerr Version: ${seerrVersion}`);
}

export const getCommitTag = (): string => {
  return commitTag;
};

export const getSeerrVersion = (): string => {
  return seerrVersion;
};

export const getAppVersion = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('../../package.json');

  let finalVersion = version;

  if (version === '0.1.0') {
    finalVersion = `develop-${getCommitTag()}`;
  }

  return finalVersion;
};
