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
6. **发布完成判定**：**不监控 Release 工作流**，推送 `v*` 标签即为手动发布流程终点，CI 异步完成后端镜像/正式 release。如需事后查状态：
   ```bash
   gh run list --repo thelinyue/sinerr --branch v1.7.6 --limit 1
   gh release view v1.7.6 --repo thelinyue/sinerr   # 最终 draft 应为 false
   ```

### CI / Release 工作流行为

- **create-tag.yml**：仅 `main` 分支 workflow_dispatch，用 git-cliff 计算下个版本并打 tag（本仓库手动发布不用它）。
- **release.yml**（推送 `v*` tag 触发）：`Generate changelog`（git-cliff 读 `.github/cliff.toml` 生成 CHANGELOG.md）→ `Create draft release` → `Build`（Docker amd64）→ `Publish multi-arch manifests`（`ghcr.io/thelinyue/sinerr:vX.Y.Z`、`v1.7`、`:latest`）→ `Sign images and create SBOM`（cosign + trivy）→ `Verify` → `Publish release`（draft→正式）。
- 关键要点：镜像标签 `ghcr.io/thelinyue/sinerr`；发布流程约 7 分钟；最终以 `gh release view` 确认 `isDraft=false`。

### 其他注意

- `config/settings.json` 被 gitignore（含本地密钥/测试服务器），**不要提交**。
- 本仓库 `release` 分支是发布分支；`main` 是 CI 的 create-tag 分支。
- 中文注释与中文提交信息是仓库惯例。

## WSL 本地预览容器维护

两个预览容器（`sinerr-pgapp` :5056 postgres / `sinerr-leaderboard` :5055 sqlite，+ `sinerr-pg` 数据库）运行生产镜像 `sinerr:pgtest`（`node dist/index.js`，构建于 `~/seerr`）。登录：`admin`（sqlite 卷 id 非 1，用 `/api/v1/auth/me` 取真实 id；postgres 卷 id=1）。登录接口字段是 `username` 而非 `email`。

### StatusChecker「请点击下面的按钮，重新加载应用程序」弹窗（阻塞卡死）

**根因**：前端 `next.config.ts` 里 `commitTag: process.env.COMMIT_TAG || 'local'`（默认 `'local'`），后端 `/api/v1/status` 返回容器内 `committag.json` 的 `commitTag`。生产镜像构建时 committag.json 是 `{"commitTag": ""}`（空串），`'' !== 'local'` → `src/components/StatusChecker` 判定「应用已更新」，弹出无法点背景关闭的 Modal，表现为页面一直卡住。

**修复**（两个容器都要执行，各自独立 exec）：
```bash
docker exec sinerr-pgapp sh -c 'printf "{ \"commitTag\": \"local\" }" > /app/committag.json'
docker exec sinerr-leaderboard sh -c 'printf "{ \"commitTag\": \"local\" }" > /app/committag.json'
docker restart sinerr-pgapp sinerr-leaderboard
```
- `committag.json` 必须是合法 JSON（后端 `require()` 解析），`{ commitTag: local }` 会解析失败。
- 改完后 `/api/v1/status` 应返回 `"commitTag":"local"`。
- ⚠️ Windows→WSL 传脚本时用 `printf`（sh 的 `echo` 会吞引号），且避免 UTF-8 BOM（`[IO.File]::WriteAllText` 默认无 BOM）。

### 构建缓存陷阱

- `server/tsconfig.json` 有 `incremental: true`，tsc 增量缓存曾导致**编译产物不包含新代码**（旧 dist 残留）。改代码后必须删本机 `dist/` 再 `pnpm build`。
- Docker 构建上下文被 `.dockerignore` 排除 `dist`/`.next`，改前端/服务端代码后需把 `src`/`server`/`sinerr-api.yml` 同步到 WSL `~/seerr` 再 `docker build`（必要时 `--no-cache`，pnpm 依赖网络不稳时配代理 `--build-arg HTTP_PROXY=http://127.0.0.1:7897`）。
- 新增 API 路由必须同步补充 `sinerr-api.yml`（express-openapi-validator 校验，缺 spec 会直接 404）。

### 生产环境配置（192.168.10.150:5055，WSL 测试可复用）

- 登录：`linyue` / `lzj3621754`（`username` 字段，非 email）。
- **MoviePilot**：`192.168.10.150:3400`，apiKey `XYwntJ-hgX_CRN7CvG0m4g`，externalUrl `https://mp.linyue.vip`，syncEnabled true。
  - ⚠️ MP 订阅 `type` 返回**中文**（`电视剧`/`电影`），非 `tv`/`movie`——`refreshSubscriptionFeedCache` 里必须做中文→英文映射，否则追剧日历永远 0 条。
  - MP 订阅 `state`：`R`=订阅中，`P`=暂停，`S`=完成。
- **Emby**：用户 jellyfinUserId `99651f42c42a4c78be9e2b2d523abab3`（日志可见）。
- 生产环境用**独立部署**（非本机 WSL 预览容器），改代码需构建镜像后部署到该服务器。
