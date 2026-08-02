# Releasing a New Version of Sinerr

This runbook is for maintainers publishing a formal Sinerr release. The release
is triggered by pushing a `v*` git tag, which runs the **Sinerr Release**
GitHub Actions workflow (changelog generation, Docker image build/push to
`ghcr.io/thelinyue/sinerr`, cosign signing + SBOM, and GitHub Release
publishing).

## Prerequisites

### 1. Pin the GitHub CLI to the fork

This repository configures two remotes: `origin` (the fork
`thelinyue/sinerr`) and `upstream` (`seerr-team/seerr`). With both present, the
GitHub CLI (`gh`) can silently resolve the **upstream** repo, so every `gh run`,
`gh workflow`, and `gh release` query targets the wrong repository.

Always pin `gh` to the fork before releasing:

```bash
gh repo set-default thelinyue/sinerr
```

This writes `remote.origin.gh-resolved` to the local `.git/config` and is
scoped to this clone. To check or fix it automatically (recommended on a fresh
clone), run:

```bash
node bin/ensure-gh-repo.mjs
```

Verify afterwards:

```bash
gh repo view --json nameWithOwner -q .nameWithOwner
# -> thelinyue/sinerr
```

> `gh` must be authenticated as a user with push access to
> `thelinyue/sinerr` (`gh auth status`).

## Release Steps

1. **Make sure everything is green**

   ```bash
   pnpm test
   pnpm typecheck
   pnpm lint
   pnpm build
   ```

2. **Commit the work** using [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
   (e.g. `feat:`, `fix:`, `refactor:`, `perf:`, `test:`). The `pre-commit` hook
   runs lint-staged; the `commit-msg` hook validates the message.

3. **Bump the version** in `package.json`.

   > **Version numbering:** the fork's Sinerr releases use the `v1.7.x` line
   > (e.g. `v1.7.5`). Do **not** use `v1.8.0`–`v1.9.x` or `v3.x` — those tag
   > names are already taken by the upstream Seerr history merged into this
   > repo and would collide when creating the tag.

4. **Create the release commit**

   ```bash
   git add package.json
   HUSKY_BYPASS=1 git commit -m "release: v1.7.5 - <short summary>"
   ```

   `release:` is not a standard Conventional Commit type, so the commit-msg
   hook must be bypassed via `HUSKY_BYPASS=1` (this is how past release commits
   were created).

5. **Tag and push**

   ```bash
   git tag -a v1.7.5 -m "v1.7.5"
   git push origin release
   git push origin v1.7.5
   ```

   Pushing the `v*` tag triggers the **Sinerr Release** workflow.

6. **Release is considered done after the tag push**

   Do **not** monitor the Release workflow. Pushing the `v*` tag is the end of
   the manual release process; the GitHub Actions workflow
   (`Generate changelog` → `Build` → `Create draft release` →
   `Publish multi-arch manifests` → `Sign images` → `Verify` → `Publish
   release`) runs asynchronously on GitHub.

   If you need to check status later, run:

   ```bash
   gh run list --branch v1.7.5 --limit 1
   gh release view v1.7.5
   ```

   Expected final state: `gh release view v1.7.5` shows `isDraft=false` and the
   Docker tags `ghcr.io/thelinyue/sinerr:v1.7.5`, `v1.7`, and `:latest` are
   updated.

> Always pass `--repo thelinyue/sinerr` to `gh` if you skipped the pin step;
> otherwise release commands may target `seerr-team/seerr`.
