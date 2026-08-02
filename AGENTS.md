# Sinerr（thelinyue/sinerr）项目约定

本文件为仓库级约定，opencode 每次会话会自动加载。合并与发布请遵循以下硬约束。

## 合并前必须通过

```
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

（注意：`package.json` 的脚本是 `pnpm lint` / `pnpm typecheck` / `pnpm test`，不是 `pnpm web:*`。）

## 发布正式版流程（完整手册见 RELEASING.md）

### 版本号规则（硬约束）

- 版本线固定为 **`v1.7.x`**（当前 `v1.7.6`）。
- **不要**使用 `v1.8.0`–`v1.9.x` 或 `v3.x`：这些 tag 已被上游 Seerr 历史占用，创建 tag 会冲突。

### 前置：钉定 gh 到 fork

仓库有两个 remote（`origin` = thelinyue/sinerr，`upstream` = seerr-team/seerr），gh 可能解析到错误仓库。发布前必须：

```bash
node bin/ensure-gh-repo.mjs   # 或 gh repo set-default thelinyue/sinerr
gh repo view --json nameWithOwner -q .nameWithOwner  # 必须输出 thelinyue/sinerr
```

gh 认证账号：`thelinyue`（`gh auth status`）。

### 发布步骤

1. **全绿**：`pnpm test && pnpm typecheck && pnpm lint && pnpm build`
2. **提交功能**：用 Conventional Commits（`feat:`/`fix:`/`refactor:`/`chore:` 等）。subject 建议用中文或小写开头。
   - ⚠️ **commitlint 硬性约束**：subject 不能以 ASCII 大写字母开头（如 `MoviePilot` 会被 `subject-case` 拒绝）。用 `集成 MoviePilot、...` 这类中文开头。
3. **升版本**：`npm version 1.7.6 --no-git-tag-version --no-commit-hooks`
4. **创建 release 提交**：
   ```bash
   git add package.json
   $env:HUSKY_BYPASS='1'; git commit -m "release: v1.7.6 - <中文摘要>"; Remove-Item Env:HUSKY_BYPASS
   ```
   - `release:` 非标准 Conventional 类型，必须 `HUSKY_BYPASS=1` 跳过 commit-msg 钩子。
   - ⚠️ PowerShell 不支持 `HUSKY_BYPASS=1 cmd` 前缀语法，必须用 `$env:HUSKY_BYPASS='1'; ...` 形式。
5. **打标签并推送**：
   ```bash
   git tag -a v1.7.6 -m "v1.7.6"
   git push origin release
   git push origin v1.7.6
   ```
   推送 `v*` 标签即触发 **Sinerr Release** 工作流（`.github/workflows/release.yml`）。
6. **验证**：
   ```bash
   gh run list --repo thelinyue/sinerr --branch v1.7.6 --limit 1
   gh run view <run-id> --repo thelinyue/sinerr
   gh release view v1.7.6 --repo thelinyue/sinerr   # draft 应为 false
   ```

### CI / Release 工作流行为

- **create-tag.yml**：仅 `main` 分支 workflow_dispatch，用 git-cliff 计算下个版本并打 tag（本仓库手动发布不用它）。
- **release.yml**（推送 `v*` tag 触发）：`Generate changelog`（git-cliff 读 `.github/cliff.toml` 生成 CHANGELOG.md）→ `Create draft release` → `Build`（Docker amd64）→ `Publish multi-arch manifests`（`ghcr.io/thelinyue/sinerr:vX.Y.Z`、`v1.7`、`:latest`）→ `Sign images and create SBOM`（cosign + trivy）→ `Verify` → `Publish release`（draft→正式）。
- 关键要点：镜像标签 `ghcr.io/thelinyue/sinerr`；发布流程约 7 分钟；最后以 `gh release view` 确认 `isDraft=false`。

### 其他注意

- `config/settings.json` 被 gitignore（含本地密钥/测试服务器），**不要提交**。
- 本仓库 `release` 分支是发布分支；`main` 是 CI 的 create-tag 分支。
- 中文注释与中文提交信息是仓库惯例。
