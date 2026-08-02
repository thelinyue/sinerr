#!/usr/bin/env node

/**
 * Ensures the GitHub CLI (`gh`) resolves to the Sinerr fork repository
 * (`thelinyue/sinerr`) instead of the upstream Seerr repository.
 *
 * When a checkout configures both `origin` (the fork) and `upstream`
 * (`seerr-team/seerr`) remotes, `gh` may resolve to the wrong one. This pins
 * the default via `gh repo set-default`, which persists as
 * `remote.origin.gh-resolved` in the local `.git/config`.
 *
 * Run before any release/`gh` commands on a fresh clone:
 *
 *   node bin/ensure-gh-repo.mjs
 */

import { spawnSync } from 'node:child_process';

const OWNER_REPO = 'thelinyue/sinerr';

const run = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Never touch configuration in CI (the gh default repo is meaningless there).
if (process.env.CI !== undefined) {
  console.log('[ensure-gh-repo] CI detected, skipping.');
  process.exit(0);
}

const gh = run('gh', [
  'repo',
  'view',
  '--json',
  'nameWithOwner',
  '-q',
  '.nameWithOwner',
]);
if (gh.status !== 0) {
  console.warn(
    '[ensure-gh-repo] gh is unavailable or not authenticated; skipping.'
  );
  console.warn(gh.stderr.trim());
  process.exit(0);
}

const resolved = gh.stdout.trim();
if (resolved === OWNER_REPO) {
  console.log(`[ensure-gh-repo] gh already resolves to ${OWNER_REPO}.`);
  process.exit(0);
}

console.log(
  `[ensure-gh-repo] gh resolves to "${resolved}". Pinning to ${OWNER_REPO}...`
);
const set = run('gh', ['repo', 'set-default', OWNER_REPO]);
if (set.status !== 0) {
  console.error(
    `[ensure-gh-repo] Failed to pin gh default repo: ${set.stderr.trim()}`
  );
  process.exit(1);
}
console.log(`[ensure-gh-repo] Pinned gh default repo to ${OWNER_REPO}.`);
