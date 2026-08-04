# Sinerr 2.0 大更新设计文档（总纲）

> 状态：评审中（各模块未开始编码，标注「已实现」的除外）
> 目标版本线：Sinerr `v1.7.x`；Emby 插件 fork 独立维护
> 前置：Sinerr 合并前必须通过 `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build`
> 溯源：本文件为 Sinerr 2.0 唯一主文档，整合并取代以下设计稿：
> `DESIGN-social-features.md` / `DESIGN-activity-presence.md` / `DESIGN-discover-2.0.md` / `DESIGN-emby-progress-plugin.md`
> 评审记录：多轮评审已消除「首页预览冗余」「Hero 与滑块重复」「高亮冲突」等逻辑冲突，采纳「模块 3 复用 Episode 表」「声援入口组件化」「RECENT_VIEW 门控」等优化。

---

## 1. 总览

### 1.1 2.0 愿景

把 Sinerr 从「纯请求-审批工具」升级为「**私域媒体的社区中心**」：探索页成为媒体推荐 + 社群动态的统一入口；电视剧更新可视化；剧集进度按季可感知；动态不再藏在独立页。

### 1.2 模块清单

| # | 模块 | 内容 | 状态 |
| --- | --- | --- | --- |
| 0 | 社交玩法基线 | 声援、动态流、短评、徽章 | **已实现** |
| 1 | 动态存在感 | 侧栏 + 动态 Tab 未读红点与计数 | 设计评审中 |
| 2 | 探索页 2.0 | 发现/动态双 Tab + 顶部轮播 Hero + 剧集更新 | 设计评审中 |
| 3 | Emby 播放进度 | 复用 Episode 表做本地季集结构 + 插件聚合 API（按季进度） | 设计评审中 |
| 4 | Episode 驱动延伸 | 追更通知 / 追更中区块 / 详情页新增提示 / 查看全部页 | 设计评审中 |
| 5 | 声援入口优化 | VoteButton 组件化 + 媒体级接口 + 详情页/Hero/卡片/SlideOver 多入口 | 设计评审中 |
| 6 | 权限与文案校正 | 权限设置 4K 残留文案清理 + 恢复 RECENT_VIEW 门控最近添加 | 设计评审中 |
| 7 | 头像功能恢复 | 代理显示 Jellyfin/Emby 真实头像 + 支持本地上传/移除头像 | 设计评审中 |
| 8 | 用户创建修正 | Emby 账号密码 bug 修复 + 自动生成密码文案优化 | 设计评审中 |
| 9 | MCP 服务 | 为 openclaw 等 AI 代理提供 Model Context Protocol 接入 | 设计评审中 |
| 10 | 企业微信通知 | WeCom 应用消息 API 通知渠道 | 设计评审中 |

### 1.3 依赖关系与执行阶段

```
阶段零：模块 6（权限与文案校正）—— 独立小修，可随时先行合入
阶段一：模块 2-A（探索页双 Tab）—— 纯前端，后端零改动，风险最低
阶段二：模块 2-B（轮播 Hero + Episode 表）—— 后端链路先行
阶段三：模块 1（未读红点）—— 依赖 2-A 后的动态入口
阶段四：模块 3（Emby 进度）—— 依赖 2-B 的 Episode 表
阶段五：模块 4（Episode 驱动延伸）—— 依赖 2-B 的 Episode 表，F1 通知另需通知基建
阶段六：模块 5（声援入口优化）—— 独立，媒体级接口 + 前端多入口
阶段七：模块 7（头像功能恢复）—— 独立，代理 + 上传端点 + 设置页 UI
阶段八：模块 8（用户创建修正）—— 独立小修，后端 + 文案
阶段九：模块 9（MCP 服务）—— 独立，新依赖 + 路由 + 工具集
阶段十：模块 10（企业微信通知）—— 独立，新通知 agent + 设置 UI
```

- 模块间无强耦合，各自独立合入 `release` 分支。
- 提交信息中文 subject（commitlint 硬约束：不以 ASCII 大写开头）。
- 版本线固定 `v1.7.x`，不使用 `v1.8+/v3.x`（tag 已被上游占用）。

---

## 2. 模块 0：社交玩法基线（已实现）

### 2.1 已落地能力

| 能力 | 载体 | 位置 |
| --- | --- | --- |
| 请求声援 | `RequestVote` 实体 + `POST/DELETE /request/:id/vote`，卡片声援按钮 + 头像聚合 + `REQUEST_VOTED` 通知 | `server/entity/RequestVote.ts`、`server/routes/vote.ts`、`RequestCard` |
| 动态信息流 | `GET /activity?take&skip` 多次分页聚合（request/vote/issue/playback/review），`ActivityList` 过滤/只看我/日期分组/无限滚动 | `server/routes/activity.ts`、`src/pages/activity.tsx` |
| 媒体短评 | `MediaReview`（1-5 星 + 一句话，支持季/集目标）+ `GET/POST/DELETE /review` | `server/entity/MediaReview.ts`、`server/routes/review.ts`、`MediaReviewBlock` |
| 成就徽章 | `GET /user/:id/achievements` 按需聚合 6 徽章进度 | `server/routes/user/index.ts`、`UserProfile/Achievements` |

### 2.2 权限约定（沿用）

- 声援挂 `Permission.VOTE`（默认权限模板含 VOTE）；短评复用 `REQUEST`；动态流 `isAuthenticated()`。

---

## 3. 模块 1：动态存在感（未读红点）

### 3.1 问题

侧边栏「动态」普通入口无主动触达；2.0 后入口指向 `/?tab=activity`，用户仍可能不知道有没有新动态。

### 3.2 方案（评审确认：取消首页预览）

- 2.0 中「动态 Tab」本身就是入口存在感，**不再做首页动态预览块**（原一期方案，被双 Tab 取代）。
- **未读红点 + 计数**：
  - 后端：`GET /activity/count?since=<iso>` 返回五表（request/vote/issue/playback/review）`createdAt > since` 计数之和，**无状态**（since 由前端传）。
  - 前端：**共享 `useActivityUnreadCount` hook**（读 localStorage `activity-last-seen` 默认 24h 前 + 轮询 count），**侧栏「动态」入口与 Discover「动态」Tab 标签都显示**未读数（存在感主战场在探索页）。
  - 进入即已读：`ActivityList` 挂载时写 `activity-last-seen`（双 Tab 下切到动态 Tab 即触发，无副作用）。
  - 未读模型：**固定窗口**，服务端不存 lastSeen；多端/清 localStorage 会重算，可接受。
  - **实现（H5）**：count 用一次 UNION ALL 查询合成五表计数，替代 5 次独立 COUNT。

### 3.3 契约

`sinerr-api.yml` 声明 `GET /activity/count`。

---

## 4. 模块 2：探索页 2.0

### 4.1 模块 A：发现 / 动态 双 Tab

- **Tab 状态**：`router.query.tab` 驱动，`/discover`（默认发现）、`/?tab=activity`（动态）；URL query 而非 local state（刷新保持/可分享/后退可用）。
- **Tab 栏形态**：吸顶 segmented（`sticky top-16 z-10`，发现/动态等宽段 + 图标），与类型过滤胶囊视觉区分；切换 Tab 保留各自滚动位置。
- **动态 Tab**：复用 `ActivityList`，组件化加 `basePath`（默认 `/activity`）/`showPageTitle`/`embedded` 三个 prop，默认值对齐现状；嵌入时外层 `px-0` 防双重内边距。
- **动态 Tab 过滤切换（评审确认：方案 C）**：类型过滤用**图标行 + 计数**（全部/请求/声援/播放/短评，每项图标 + 数字徽标，横滑），「只看我」独立为右侧胶囊开关——替换原「pill 混排 + 只看我」拥挤布局，信息密度高、移动端友好。
- **导航与重定向**：Sidebar + MobileMenu「动态」→ `/?tab=activity`；`/activity` 客户端 `router.replace` 透传 `type/userId`。
- **ConnectionGuide / 管理编辑按钮**：仅发现 Tab 显示。
- **侧栏高亮（评审已解决）**：用 `router.asPath`（含 query）判定——动态项 `asPath.includes('tab=activity')`、Discover 项 `!includes`，两者互斥，`/discover` 高亮 Discover、`?tab=activity` 高亮动态。

### 4.2 模块 B：顶部轮播 Hero + 剧集更新

**数据链路**：Jellyfin episode(`DateCreated`) → 扫描器 upsert → `Episode` 表 → `GET /discover/recentlyadded` → Hero 组件 → 按需拉剧集详情判定完结。

1. **`Episode` 实体**（新表）：`id` / `media`(ManyToOne, CASCADE) / `seasonNumber` / `episodeNumber` / `jellyfinEpisodeId`(unique) / `addedAt`(Jellyfin DateCreated) / `createdAt`。索引 `IDX_EPISODE_MEDIA_ADDED`(mediaId, addedAt)、`IDX_EPISODE_MEDIA_SEASON`(mediaId, seasonNumber)（H3，模块 3 按季查询与 F3 用）+ `UQ_jellyfinEpisodeId`。双库迁移 `1788000000000-AddEpisode`。
2. **扫描写入**：`getEpisodes` 追加 `fields: 'DateCreated'`；`processShow` 内批量 upsert——**只插不更**（`ON CONFLICT DO NOTHING`）、季内集数一致跳过、多集合并文件只记起始集号。
   - **⚠ 关键实现项（评审发现）**：`getRecentlyAdded`（`jellyfin.ts:452`）走 `/Items/Latest`，**新加的单个 Episode 本身就是 latest item**；recent scan 用 `uniqWith` 按 SeriesId 去重保留第一项，代表项往往为 Episode，而 `processItem`（`jellyfin/index.ts:360`）只处理 Movie/Series——**Episode 项会被静默跳过**，导致该剧 Episode 记录滞后到每日全量扫描。**解法**：`processItem` 增加 `Episode` 分支，按 `item.SeriesId` 走 `processJellyfinShow`（仓库已有「Episode 起头」先例，见 `jellyfin/index.ts:89` anidb movie 分支）。
   - **新鲜度保证（评审确认）**：`webhook.ts:369` 已监听 `library.new` / `item.updated` / `system.libraryscancomplete` 并触发 recent scanner，叠加 5 分钟轮询兜底（`settings/index.ts:563`）——修复上一项后，Episode 表新鲜度 = 秒级~分钟级。
3. **聚合端点**：`GET /api/v1/discover/recentlyadded?days=7&take&skip`，返回 `{ media, episodeCount, newEpisodes: [{seasonNumber, episodeNumber, addedAt}], latestEventAt }`；不动 `/api/v1/media` 共享语义；**鉴权 `isAuthenticated(Permission.RECENT_VIEW)`（模块 6 门控）**。
   - **实现（评审优化）**：单条 QueryBuilder `LEFT JOIN episode ... GROUP BY media.id` 一次拿全（media + episodeCount + newEpisodes + latestEventAt），替代 EXISTS + 相关子查询，配合 `(mediaId, addedAt)` 索引。
4. **Hero 组件**：**常驻「发现」Tab 最上方**（吸顶 Tab 栏之下、ConnectionGuide 之上），16:7，自动播放 6s + 悬停暂停 + 箭头 + 圆点；移动端固定 240px 高、隐藏箭头；每 slide 按需拉剧集详情判定完结。
5. **滑块配置（评审已解决）**：**移除 `DiscoverSliderType.RECENTLY_ADDED`** 类型及其渲染分支——Hero 是唯一「最近添加」出口，彻底避免管理员启用后重复。滑块类型常量、`Discover/index.tsx` 分支、`RecentlyAddedSlider` 组件一并清理。
6. **展示规则**：
   - 连载剧（`status` ≠ Ended/Canceled）：`⏱ 已更新至 第X季 第Y集`（最新更新点：季最大优先其次集最大）+ 右上角「＋N 集」。
   - 已完结剧（Ended/Canceled）：`✓ 已完结 · 全X季 · Y集`（✅ 方案 B），隐藏「＋N 集」徽标。
   - 电影：无状态行。
   - **口径统一（评审确认）**：已完结判定与官方总季/集数用 TMDB（`/tv/:tmdbId` 的 `status` / `number_of_seasons` / `number_of_episodes`）；连载「更新至」用本地 Episode 表。两口径各司其职：TMDB = 官方口径，Episode = 本地更新口径。

### 4.3 移动端适配（模块共用原则）

吸顶 segmented、动态列表留白卡片不通栏、Hero 加高、切换保留滚动位置、pill 横滑、隐藏次要标签。

### 4.4 模块 C：Episode 驱动延伸功能

建立在 2-B 的 Episode 表之上，四个独立小功能，各自可合入。

#### F1 追更通知（新集推送）

- **触发（H1）**：扫描批量 upsert 后，**显式聚合通知**——一次查询新增集的 `mediaId` 集合 → 每剧聚合发一条。⚠ **不用 `@AfterInsert` subscriber**：批量 `insert().orIgnore()` 不触发 TypeORM subscriber，显式聚合更可靠且天然满足防轰炸。
- **目标用户**：该剧的**请求人 + 声援人**（去重）；`sendNotification` 按用户循环调用（payload `notifyUser`，家庭/小团队量级可接受）。
- **载体**：现有通知基建——`Notification` 枚举新增 `EPISODE_UPDATED = 16384`；`UserSettings.notificationTypes` 的 `ALL_NOTIFICATIONS` 自动纳入。
- **⚠ 成本修正（评审发现）**：新通知类型是**横切改动**——枚举 + 类型守卫 + **约 10 个通知 agent 的 switch 分支**（`server/lib/notifications/agents/` 下 email/webpush/telegram/discord/slack/ntfy/gotify/pushover/pushbullet/webhook）+ 设置 UI + 文案，工作量按此估计。
- **文案**：「你追的《{title}》更新了 / 已更新至 第X季 第Y集」（复用 ⑤ 最新更新点共享工具；已完结剧尾批改「已完结 · 全X季 · Y集」）。
- **防轰炸**：一次扫描多集新增只发一条（聚合到最新更新点）；同剧每日上限 1 条。
- **设置项**：`UserSettings` 通知类型可单独开关（前端设置页列表新增条目）。

#### F2 个人页「追更中」区块

- **位置**：`UserProfile`「最近观看」区块之后。
- **隐私（评审确认）**：仅**本人 + 管理员 + `REQUEST_VIEW` 权限**可见（与请求可见范围一致）；无权限时隐藏区块。
- **数据**：我请求或声援过的剧（`MediaRequest.requestedBy` + `RequestVote.user`）∩ Episode 表最新更新状态；按 `latestEventAt` 降序，有新集优先、高亮。
- **端点**：`GET /user/:id/following-updates?take` → `[{ media, episodeCount, newEpisodes, latestEventAt }]`（复用 ⑥ recentlyadded 聚合服务函数，过滤为我的剧）。
- **展示**：复用轮播展示规则——连载「已更新至 第X季 第Y集 ＋N集」绿色高亮，完结「已完结 全X季 Y集」灰字。

#### F3 详情页季区块「最近新增」提示

- **位置**：`TvDetails` 季标题行（`Disclosure.Button` 右侧，`TvDetails/index.tsx:626-733` 已验证）。**⚠ 与模块 3 进度徽标同改同一行**——两功能必须**合并为一次改动**实施，避免文件冲突与样式打架。
- **数据（H2）**：**并入 `/tv/:tmdbId` 详情响应**（`mediaInfo.recentEpisodes`，按 mediaId 查 Episode 表单查询），**不建新端点**——TvDetails 页已请求该详情接口，免额外请求与 SWR。
- **展示**：季标题行追加「最近新增 E4–E6」chip；连续集折叠区间，分散集逐列（复用轮播 chips 折叠规则）；无新增不显示。

#### E3 「查看全部」列表页

- **入口**：轮播 Hero 右上角「查看全部 →」。
- **页面**：`/discover/recentlyadded`，复用 `recentlyadded` 端点分页（`take/skip`），横版卡片网格（复用轮播展示规则），类型筛选 + 无限滚动/加载更多。
- **门控**：需 `Permission.RECENT_VIEW`（模块 6）。
- **纯前端 + 端点复用**，成本极低。

### 4.5 共享工具与协调点

1. **最新更新点共享工具**（`computeLatestPoint`）：Hero（2-B）、F1 通知文案、F2、F3 四处统一计算「已更新至 第X季 第Y集」（季最大优先其次集最大），服务端聚合端点统一输出、前端仅展示，避免算法分叉。
2. **recentlyadded 聚合服务函数**：`/discover/recentlyadded`、`/user/:id/following-updates` 共享同一聚合 SQL（仅过滤条件不同），避免重复查询逻辑；F3 改走 `/tv/:tmdbId` 详情（H2）。
3. **模块 3 的 seriesId → Episode 关联路径**：Episode 表无 seriesId，经 `Media.jellyfinMediaId`（=seriesId）中转：`seriesId → Media(jellyfinMediaId) → Media.id → Episode.mediaId`。
4. **TvDetails 改动合并**：模块 3 进度徽标 + 模块 4 F3 新增 chip，同一次提交完成。
5. **H1 通知聚合**：F1 批量插入后显式聚合通知，不走 subscriber。
6. **H3 索引**：`IDX_EPISODE_MEDIA_SEASON`(mediaId, seasonNumber) 服务模块 3 / F3 按季查询。
7. **H5 count**：模块 1 未读数用 UNION ALL 合成一条。

### 4.6 ConnectionGuide 用户引导优化（方案 A + 文案定稿）

#### 位置与形态（评审确认：方案 A，搜索下拉集成）

- 现状：发现页顶部常驻横幅，占首屏黄金位。
- 优化：**引导集成进搜索下拉**——聚焦搜索框时，下拉在「首次 / 空搜索」场景于结果上方显示「三步开启观影」；有搜索结果时只出媒体、隐藏引导；**首页移除常驻横幅**，探索页更干净。
- 触发语义：用户在「想找片但可能还没播放器」的搜索时刻才见引导，精准不打扰。
- placeholder 弱引导：「搜索影视 · 三步开始观看」。

#### 文案定稿（动词 + 结果）

- 标题：「三步开启观影」。
- ① 装好客户端 —— 「手机 / 平板 / 电视安装 Emby 客户端」。
- ② 连上服务器 —— 「类型选 **Emby**，地址填 {server}」。
- ③ 登录即看 —— 「账号 {username} + 密码」。
- 一键「复制全部信息」，便于管理员发给用户。

#### 服务器类型提醒

- 在步骤 ②（连上服务器）：按 `settings.currentSettings.mediaServerType` 动态提示「服务器类型请选择 **Emby/Jellyfin**（选错将无法连接）」。
- 演示弹窗（guideDemo）加「服务器类型」字段高亮展示。

#### 登录账号修正

- 步骤 ③ 登录账号用 `user?.jellyfinUsername || user?.username`（**用户名字段**），不用 `displayName`/昵称——否则设置了昵称的用户，提示的登录账号与真实账号不符。

#### i18n

- 新增/修改引导文案键，zh-Hans + en 同步。

---

## 5. 模块 3：Emby 播放进度二次开发

### 5.1 边界原则（评审确认）

**播放数据层**（历史/统计/进度/时长）→ 统一走插件语义化 API；**媒体库层**（登录/鉴权/用户/媒体库/季集结构元数据/图片）→ 直连 Emby 原生。不做「全量进度同步进 Sinerr 本地表」主路径（Emby 为唯一事实源；Sinerr 本地 `PlaybackEvent` 仅 webhook 驱动的评论人进度）。

### 5.2 执行策略（评审确认：复用 Episode 表）

- **本地季集结构（复用模块 2-B 的 Episode 表）**：`jellyfinEpisodeId` / `seasonNumber` / `episodeNumber` 经 `Media.jellyfinMediaId` 关联 series id——替代「getSeasons + N 次 getEpisodes」的 N+1 遍历。**删除原「结构缓存 24h」设计**（本地查表零遍历、扫描即更新、永远新鲜），消除与 Episode 表的重复建设。
- **进度缓存（60s，温和优化）**：`series-progress-{userId}-{seriesId}`，播放停止后 Emby 写入，60s 内展示旧值可接受。
- **插件聚合 API（最终方案）**：
  - 插件 `PlaybackActivity` 表加 3 可空列：`SeriesId` / `SeasonId` / `ParentIndexNumber`；复用插件 schema 自动迁移，老库升级自动执行；`EventMonitorEntryPoint.GetPlaybackInfo()` 落库前从 `NowPlayingItem` 填充。
  - 新增聚合 API `GET /user_usage_stats/series_progress/{seriesId}?userId=` → `{ seasons: [{seasonNumber, total, watched}] }`；`total` 插件进程内本地 `GetItemList` 计算（实时、无缓存过期），`watched` 按新增列 GROUP BY。
  - Sinerr `getSeriesProgress()` 调插件接口，404 回退本地 Episode 表 + 进度缓存逻辑（兼容双版本）。
  - `/user/:id/media/:tmdbId/:mediaType/playback` 剧集分支增加 `seasons[]`，保留顶层 `watchedEpisodes/totalEpisodes`。
  - 前端 `TvDetails` 季标题行追加进度徽标「第{n}季 已看 x/y」，`x===y` 整季绿勾「已看完」；**追加而非替换**现有状态徽标（与 F3 合并改）。
- **不做**：老数据回填（自然增量，`ParentIndexNumber IS NULL` 不计入按季聚合）。

---

## 6. 模块 5：声援入口优化

### 6.1 现状问题

声援（RequestVote）入口**只在 `RequestCard`**（`src/components/RequestCard/index.tsx:253-267`），且锚定请求级（`server/routes/vote.ts` 为 `/request/:id/vote`）。媒体详情页只有 `RequestButton` 无声援；Discover、Hero、SlideOver 均无——用户「看完想表达也想要」时找不到入口。

### 6.2 方案（评审确认，五项全采纳）

1. **`VoteButton` 组件化**：从 RequestCard 抽出「声援按钮 + 计数 + 头像聚合 + 乐观更新」，以媒体级接口为 prop，一处实现、多处复用。
2. **媒体级声援接口**：`GET/POST/DELETE /media/:tmdbId/:mediaType/vote` → `{ voteCount, userVoted, activeRequestId }`。服务端定位该媒体「当前请求」（优先 PENDING 最早创建的），在其上点赞；继承现有规则：自赞 400、幂等、点赞者列表隐私（请求人 + `REQUEST_VIEW`）。
3. **媒体详情页声援区（主入口）**：Movie/TV 详情页 RequestButton 旁新增「♥ N 人想看」+ VoteButton；有请求才显示。
4. **Hero 轮播声援徽标**：2.0 轮播每 slide 显示「♥ N 人想看」（`recentlyadded` 端点附带 `voteCount`），点击直达详情页。
5. **Discover 媒体卡片声援徽标**：TitleCard 覆盖层显示声援数（该媒体有请求时）。
6. **请求管理 SlideOver 声援区**：展示声援者头像列表（复用 `/request/:id/votes` 接口）。

### 6.3 数据与隐私注意点

- 同媒体多人请求时，聚合计数**按用户去重**（避免同一用户给同一媒体的多条请求点赞被重复计数）。
- 自赞规则、点赞者列表可见范围均不变（仅请求人 + `REQUEST_VIEW` 可见头像列表，其余登录用户仅见数量）。
- `sinerr-api.yml` 声明媒体级声援端点。

---

## 7. 模块 6：权限与文案校正

### 7.1 权限设置文案优化（4K 残留清理）

- **现状**：请求流程已不区分 4K/非 4K（`PermissionEdit/index.tsx` 源文案已无 4K），但 `zh_Hans.json` 仍残留 **62 处** 4K 文案，`en.json` 亦有：
  - **活跃键描述错误**：`requestDescription`「授予提交非 4K 媒体请求的权限」等需去掉「非 4K」限定（同 `requestMoviesDescription` / `requestTvDescription` / `autoapproveDescription` / `autoapproveMoviesDescription` / `autoapproveSeriesDescription`）。
  - **死键删除**：`request4k*` / `autoapprove4k*` 对应权限项已从 UI 移除，从 `zh_Hans.json` / `en.json` 删除。
- **范围**：本轮清理 zh_Hans（主）+ en（同步）；其余 40+ 语言文件仅活跃键的「非 4K」限定留待后续批量清理（其对应权限项已不存在，不影响渲染）。

### 7.2 恢复 RECENT_VIEW 门控「最近添加」

- **现状**：`Permission.RECENT_VIEW`（`server/lib/permissions.ts:19`）已定义、已在 `PermissionEdit` 展示，但**全仓库零执行点**；最近添加内容对登录用户全部可见（`/api/v1/media` 甚至无鉴权中间件）。
- **方案**：
  - `recentlyadded` 端点鉴权：`isAuthenticated(Permission.RECENT_VIEW)`（替代原 `isAuthenticated()`）。
  - Hero 组件：无 `RECENT_VIEW` 不渲染；E3 查看全部页同样门控（组件内 `hasPermission` 判断）。
  - 默认权限模板：`Permission.REQUEST | Permission.VOTE | Permission.RECENT_VIEW`（`settings/index.ts:396`，恢复默认可见）。
  - 存量 `/api/v1/media` 媒体库接口不动（RECENTLY_ADDED 滑块已随 2.0 移除，无冲突）。

---

## 8. 模块 7：头像功能恢复

### 8.1 现状问题

- **显示**：`getUserAvatarUrl()`（`server/routes/auth.ts:48`）对所有用户返回 `/avatarproxy/default`；`avatarproxy.ts`（`server/routes/avatarproxy.ts`）忽略 `jellyfinUserId`，一律返回默认剪影 SVG——所有用户头像相同，真实头像不展示。
- **上传**：全仓库无上传实现（无 `multer`/`busboy` 依赖、无 upload 端点、无存储目录）；`UserGeneralSettings` 无头像 UI。
- **遗留字段**：`User.avatar` / `avatarETag` / `avatarVersion`（Overseerr 遗留）。
- **可用基建**：`appDataPath()`（`server/utils/appDataVolume.ts`）；Jellyfin/Emby 用户头像端点 `/Users/{jellyfinUserId}/Images/Primary`。

### 8.2 头像显示（恢复真实头像）

- `getUserAvatarUrl()`：Jellyfin/Emby 用户返回 `/avatarproxy/{jellyfinUserId}`；本地用户保持 `/avatarproxy/default`。
- `avatarproxy.ts` 改造：`GET /avatarproxy/:jellyfinUserId` → 以 apiKey 请求 `${host}/Users/{jellyfinUserId}/Images/Primary`，**流式转发**真实头像；404/失败回退默认 SVG；设置 `Cache-Control`（复用 imageproxy 的 ETag/过期模式可选）。

### 8.3 头像上传（新功能）

- **依赖决策**：引入 `multer`（multipart 解析，标准方案）——评审点；备选为手写 multipart 解析（避免新依赖）。
- **端点**：
  - `POST /user/:id/avatar`（本人或 `MANAGE_USERS`）：接收图片（png/jpg/webp，≤2MB），存 `<appDataPath>/avatars/<userId>.<ext>`，更新 `user.avatar = /avatarproxy/upload/<userId>`，清头像缓存。
  - `DELETE /user/:id/avatar`：删文件，头像回退为 Jellyfin 头像（或默认）。
  - 服务：`avatarproxy.ts` 增加 `/upload/:userId` 读本地文件返回。
- **优先级**：本地上传 > Jellyfin 头像 > 默认剪影。

### 8.4 前端

- `UserGeneralSettings` 新增**头像区块**：当前头像预览（`CachedImage type="avatar"`）+ 文件选择 + 上传 + 移除按钮。
- i18n：`上传头像` / `移除头像` / `头像格式与大小限制` 等，zh-CN / en 同步。

### 8.5 安全

- 上传校验：MIME 白名单 + 大小上限 + 文件名安全化（不使用用户原始文件名）。
- 读取：`/avatarproxy/upload/:userId` 仅服务本人头像文件路径，杜绝路径穿越。

---

## 9. 模块 8：用户创建修正

### 9.1 Emby 账号无法登录（Bug 修复）

- **根因**：`JellyfinAPI.createUser`（`server/api/jellyfin.ts:550`）调 `POST /Users/New` 传 `{ Name, Password, HasPassword }`，较新 Jellyfin/Emby 的 `/Users/New` **忽略 Password 字段**——只建账号未设密码，导致「同时创建 Emby 账号 + 自动生成密码」后 Emby 无法登录。
- **修复**：
  - `JellyfinAPI` 新增 `updateUserPassword(userId, newPassword)`：`POST /Users/{id}/Password` body `{ NewPassword, ResetPassword: false }`。
  - `server/routes/user/index.ts` createEmby 分支（`createUser` 成功后）显式调用设置密码。
- **顺带修正**：「同时创建 Emby 账号」勾选框 UI 仅 `mediaServerType === EMBY` 显示（`UserList/index.tsx:569`），但后端同时接受 JELLYFIN——条件放宽为 `EMBY || JELLYFIN`。

### 9.2 自动生成密码文案优化

- **现状**：`autogeneratepasswordTip` = "Email a server-generated password to the user"（zh「通过电子邮件发送…」）——**错误**：实际密码在创建后**展示给管理员**（`setGeneratedCredentials` 弹窗），**无需电子邮件**。`passwordinfodescription` 为死文案（定义未使用）。
- **修复**：
  - `autogeneratepasswordTip` → 「生成随机密码，创建后直接展示（无需电子邮件）」/ en "Generate a random password and display it after creation (no email required)"。
  - `passwordinfodescription` 死文案删除或按新语义更新（zh_Hans + en 同步）。
  - 创建成功弹窗文案 `usercreatedpasswordtip`「请妥善保存，将不再显示」保留。

---

## 10. 模块 9：MCP 服务（openclaw 接入）

### 10.1 目标

为 openclaw 等 AI 代理通过 **Model Context Protocol** 访问 Sinerr 能力（查媒体、查/审批请求、读动态、查用户等）。

### 10.2 传输与鉴权

- **传输**：HTTP + SSE（`GET /api/v1/mcp` 建立 SSE 流，`POST /api/v1/mcp` 处理请求）——适合远程实例接入；不用 stdio。
- **鉴权**：独立 MCP 令牌（设置页生成/吊销），`Authorization: Bearer <token>`；令牌映射权限位，每个工具按 `hasPermission` 校验。
- **依赖**：`@modelcontextprotocol/sdk`（新依赖）。

### 10.3 初版工具集

| 工具 | 说明 | 权限 |
| --- | --- | --- |
| `search_media` | 搜索影视 | REQUEST_VIEW |
| `list_requests` / `get_request` | 查询请求列表/详情 | REQUEST_VIEW |
| `approve_request` / `decline_request` | 审批/拒绝请求 | MANAGE_REQUESTS |
| `list_activity` | 读取动态流 | 登录（isAuthenticated） |
| `list_users` / `get_user` | 用户列表/详情 | MANAGE_USERS |
| `list_recently_added` | 最近添加 | RECENT_VIEW |

### 10.4 安全

- 令牌独立于会话；可单独吊销；工具级权限校验；不暴露 API key。
- `sinerr-api.yml` 声明 MCP 端点。

---

## 11. 模块 10：企业微信通知渠道

### 11.1 形态（评审确认：应用消息 API）

- 企业微信**应用消息 API**（非群机器人 webhook）：需 `corpid` / `corpsecret` / `agentid`，可推送指定成员。

### 11.2 后端

- 新通知 agent：`server/lib/notifications/agents/wecom.ts`（仿 email/slack agent 结构）。
- 发送流程：`POST https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=&corpsecret=` 取 access_token → `POST /cgi-bin/message/send` `{ touser, msgtype: 'text', agentid, text: { content } }`（缓存 token，过期刷新）。
- `Notification` 枚举事件接入 agent switch（核心事件：请求审批/媒体状态/Issue/短评等）。

### 11.3 前端设置

- 设置页新增「企业微信通知」配置区块：`corpid` / `corpsecret` / `agentid` / 接收人 `touser`（userid，多个逗号分隔）+ 测试发送。
- 配置接口：仿现有通知 agent 设置模式（`server/routes/settings/notifications`）。

### 11.4 说明

- 「参考 mp」在仓库内无对应实现，按标准企业微信应用消息 API 设计。

---

## 12. 数据库变更汇总

| 变更 | 模块 | 说明 |
| --- | --- | --- |
| 新表 `episode` + 索引 ×3 | 2-B | sqlite + postgres 双迁移 `1788000000000-AddEpisode`；索引：`IDX_EPISODE_MEDIA_ADDED`(mediaId, addedAt)、`IDX_EPISODE_MEDIA_SEASON`(mediaId, seasonNumber)、`UQ_jellyfinEpisodeId`；模块 3 / 4 复用 |
| `Media.episodes` OneToMany | 2-B | CASCADE |
| 插件 `PlaybackActivity` +3 列 | 3 | 复用插件 schema 自动迁移，Sinerr 无迁移 |
| 模块 1 / 2-A / 4 / 6 / 7 / 8 / 9 / 10 | — | 无数据库变更（F1 通知枚举不落表；头像存文件系统；MCP 令牌存设置；WeCom 走 agent 配置） |

### 12.1 PostgreSQL 兼容性核查（评审）

| 项 | 结论 |
| --- | --- |
| Episode 双库迁移 | ✅ postgres 仿 `AddPlaybackEvent1787000000003`（SERIAL PK / TIMESTAMP / FK CASCADE / 索引） |
| ⚠️ recentlyadded `newEpisodes` JSON 聚合 | **跨库不通用**：SQLite `json_group_array` vs Postgres `jsonb_agg`。**规避**：聚合在**应用层组装**（两查询：media 列表 + episode 按 mediaId 分组，内存组装），避免 SQL 方言分支 |
| `ON CONFLICT DO NOTHING` / `INSERT OR IGNORE` | ✅ TypeORM `.orIgnore()` 按方言处理 |
| count `UNION ALL`（H5） | ✅ 两库通用 |
| datetime 差异 | ✅ `DbAwareColumn` / `resolveDbType` 已覆盖 |
| 模块 3/8/9/10 | ✅ 无 Sinerr 迁移 |

### 12.2 镜像大小优化（评审）

- **架构约束**：`server/index.ts:53` 用 `next({dev})` + `getRequestHandler()` 编程式挂载，**`output:'standalone'` 不适用**（`next start` 专用）；主导体积 = node_modules（prod）+ .next（prod build），为自定义服务端所必需。
- **可行优化 A（实施）**：runtime 阶段**选择性 COPY** 替换 `COPY . .`——只带 `dist/`、`.next/`、`node_modules`、`public/`、`package.json`、`sinerr-api.yml`（`dist/index.js:49` 引用 `../sinerr-api.yml`，必须保留），并 `mkdir config`。去掉约 9MB 源码。
- **可行优化 B（实施）**：`.dockerignore` 追加 `*.map`、`coverage`、`tests` 等，缩减构建上下文（构建速度）。
- **已优项**：alpine 基础镜像、多阶段构建、`pnpm install --prod`、native 模块裁剪、`.next/cache` 移除。
- **注**：优化 A（runtime 选择性 COPY）已被方案 2（§12.3）吸收——方案 2 的 runtime 阶段即按需 COPY；优化 B（`.dockerignore` 扩充）仍独立有效。

### 12.3 Next standalone 托管方式评估（评审）

自定义服务端职责（`server/index.ts`）：migrations/settings/bootstrap、session（TypeORM store）、CSRF、OpenApiValidator、swagger-ui、`/api/v1` 全路由、imageproxy/avatarproxy、webhook、jobs、优雅停机——`next` 只是其中一个 catch-all 路由。

| 方案 | 可行性 | 说明 |
| --- | --- | --- |
| 1. 完全切换 standalone（弃用自定义 Express） | ❌ **拒绝** | standalone `server.js` 只服务 Next 应用；需把 20+ express 路由 + session + CSRF + OpenApiValidator + swagger + 代理 + bootstrap 全部迁到 Next API route/middleware。数周工作量、高回归风险，2.0 范围外 |
| 2. **`@vercel/nft` 追踪 `dist/index.js`**（standalone 等效、可行） | ✅ **推荐** | Next 的 standalone 本质就是 nft 依赖追踪。对自定义服务端入口做同样追踪 → runtime 只带精确依赖子集。关键收益：`pnpm install --prod` 装了前后端全部 prod 依赖，而 formik/react-intl/yup/headlessui 等**纯前端依赖已打包进 `.next`，运行时不需要**——nft 可砍掉。原生模块（sqlite3/sharp/bcrypt/.node）nft 可处理。预估 **node_modules 减 30-50%**。工作量：devDep `@vercel/nft` + trace 脚本 + Dockerfile 调整；风险中等（需验证原生模块/动态 require 追踪） |
| 3. 保持现状 + 轻量优化 | ✅ | 优化 A/B 已列；收益小 |

**结论（评审确认：采纳方案 2）**：完整 standalone 重写不推荐；镜像瘦身走**方案 2**（`@vercel/nft` 追踪服务端依赖），获得 standalone 的主要收益而无需重写。`.next` 生产构建产物（前端 bundle + pages server bundle）不可避免。

#### 方案 2 实施要点（已确认）

1. **依赖**：devDep 增加 `@vercel/nft`（build 阶段安装，运行时无依赖）。
2. **trace 脚本**（`scripts/trace-server.mjs`）：`nodeFileTrace(['dist/index.js'])` 产出依赖文件清单，组装 `runtime-stage/`：
   - **pnpm 布局保留**：按相对路径复制 `.pnpm/store` 真实文件 + **重建 node_modules 顶层 symlink**（指向被追踪集），保证 require 解析正确。
   - **原生模块 allowlist**：`sqlite3` / `sharp` / `bcrypt` / `pg` 整目录纳入（nft 对 `.node`/`bindings` 动态加载可能漏，安全网）。
   - **fs 读取手动补齐**（nft 只追踪 require，不追踪 fs.readFile）：`dist/`（含 `templates/` + `i18n/`）、`seerr-version.json`（`appVersion.ts:6`）、`sinerr-api.yml`（`index.ts:49`）、`package.json`、`next.config.ts`。
3. **Dockerfile（已实施）**：移除 `prod-deps` 阶段；build 阶段 `pnpm build` 后跑 `node scripts/trace-server.mjs`（产出 `.runtime-stage/`）；runtime 只拷 `runtime-stage/` + `.next/` + `public/`，`CMD ["node", "dist/index.js"]`（`NODE_ENV=production` 已有）。`.dockerignore` 排除 `.runtime-stage`。
4. **运行时 fs 依赖**：`config/settings.json` 与 `committag.json` 为运行期生成，不入镜像。
5. **验收（仅 Docker 构建环境执行，勿在开发机跑）**：`pnpm build` 后跑 trace，`.runtime-stage/` 内 `node dist/index.js` 可启动（能连 DB、起 Next handler）；对比镜像内 node_modules 体积。预估 **node_modules -30~50%**。

---

## 13. i18n 汇总

- 模块 1：`查看全部` 等计数/红点辅助文案。
- 模块 2-A：`发现` / `动态`。
- 模块 2-B：`已更新至 第{season}季 第{episode}集`、`已完结 · 全{seasons}季 · {episodes}集`、`新增 {count} 集`。
- 模块 3：`第{n}季 已看 x/y`、`已看完`。
- 模块 4：`你追的《{title}》更新了`、`最近新增 {episodes}`、`追更中`、`查看全部`。
- 模块 5：`{count} 人想看`、`我也想看`。
- 模块 6：权限设置文案 4K 清理（见 §7.1）。
- 模块 7：`上传头像` / `移除头像` / 头像格式与大小限制提示。
- 模块 8：自动生成密码文案修正（`autogeneratepasswordTip` 等，zh_Hans + en）。
- 模块 10：企业微信通知配置与测试文案。
- 规范：zh-CN 为主，en 同步；`defineMessages`。

---

## 14. 测试策略与用例优化（评审）

### 14.1 现状基建

- runner：`node:test`（`server/test/index.mts`，已启用 `--experimental-test-module-mocks` + ts-node + `setup.ts`）。
- 模式：各 test 文件自建 `createApp()`（最小 express + session + checkUser + error 中间件）、`setupTestDb()`（seed + 每用例 reset）、supertest agent 登录。
- E2E：cypress（`discover/login/movie-details/tv-details`）。
- 现有测试：`activity/auth/issue/request/review/vote/webhook.test.ts`。

### 14.2 现存可优化点

1. `createApp` / `loginAs` / `loginWithPermissions` / `seedRequest` 各文件重复定义 → 抽共享 helpers。
2. seed 分散在各文件 → 统一 seed 工厂。
3. 缺服务层测试（聚合/扫描逻辑仅靠路由间接覆盖）。
4. 缺跨库（postgres）执行——核心查询未在 pg 下验证。

### 14.3 用例优化方案

**A. 共享测试基建**（`server/test/helpers.ts`）
- `createTestApp(routes)`、`loginAs`、`loginWithPermissions`、seed 工厂（`seedUser/seedMedia/seedRequest/seedEpisode/seedVote/seedReview`），统一行为、消除重复。

**B. 服务层测试补强**（核心逻辑直测，模块 mock）
- `recentlyadded` 聚合服务：mediaAddedAt 窗口 + `newEpisodes` 明细 + 排序 + 分页。
- Episode upsert：只插不更 / 幂等 / 季内一致跳过。
- `processItem` Episode 分支 → mock `server/api/jellyfin`。
- count UNION ALL：since 过滤 + 五表计数。
- 媒体级声援聚合：按用户去重。
- F1 通知聚合：mock `notificationManager` + 防轰炸（同剧每日 1 条）。
- F2 `following-updates` 隐私（REQUEST_VIEW）。
- 模块 8 `updateUserPassword`：mock jellyfin client。
- MCP 工具权限映射、WeCom agent 发送（mock fetch）+ token 缓存。

**C. 鉴权用例参数化（矩阵化）**
- 权限组合 × 端点参数化生成（RECENT_VIEW 门控、声援自赞 400、投票者隐私、F2 可见范围），避免手写重复。

**D. 跨库测试（关键）**
- 核心查询（recentlyadded 应用层组装、count UNION ALL）在 sqlite + postgres **双跑**；CI 增加 postgres service，`DB_URL` 指向 pg 跑一档。

**E. E2E 分层**
- cypress 只覆盖核心流程：双 Tab 切换、`/activity` 重定向、Hero 展示（已完结/连载）、声援、追更中、头像上传；细节走单元，避免 e2e 膨胀。

**F. 覆盖率**
- `pnpm test --coverage` 已支持；2.0 核心端点（recentlyadded / 媒体级声援 / count）设覆盖率目标（关键分支 ≥80%）。

### 14.4 各模块用例清单

| 模块 | 单元/接口 | E2E |
| --- | --- | --- |
| 2-A 双 Tab | —（前端） | 切换 / 重定向 / 高亮互斥 |
| 2-B | Episode upsert / 聚合服务 / `processItem` 分支 / RECENT_VIEW 403 | Hero 展示（已完结/连载） |
| 1 红点 | count（since/UNION ALL） | 红点出现/清除 |
| 3 进度 | `getSeriesProgress` mock / 404 回退 | 季进度徽标 |
| 4 | F1 通知聚合+防轰炸 / F2 隐私 / F3 详情注入 | 追更中 / 查看全部 |
| 5 声援 | 媒体级接口（幂等/自赞 400/按用户去重/隐私） | 详情声援 |
| 6 权限 | RECENT_VIEW 门控矩阵 | — |
| 7 头像 | 上传（mime/大小）/ 删除 / 代理回退 | 头像上传 |
| 8 用户创建 | `updateUserPassword` mock | 文案快照 |
| 9 MCP | 令牌鉴权 / 工具权限映射 | — |
| 10 WeCom | agent 发送（mock fetch）/ token 缓存 | 设置页 |

---

### 14.5 详细用例设计（按模块，可直接翻译为 node:test）

**模块 2-B · Episode / 聚合（`episode.test.ts` + `recentlyadded.test.ts`）**
- upsert 服务：① 新集插入（jellyfinEpisodeId 唯一键）② 重复插入幂等 ③ 季内集数一致跳过 ④ 多集合并文件只记起始集号 ⑤ 删媒体 CASCADE 清 episode。
- `processItem`：① Episode 代表项按 SeriesId 走 processShow ② Movie/Series 分支不受影响。
- `recentlyadded` 端点：① mediaAddedAt 窗口内新入库出现 ② 老剧新集出现且 `episodeCount`/`newEpisodes` 正确 ③ 排序按 `latestEventAt` DESC ④ `take/skip` 分页 ⑤ 无 `RECENT_VIEW` → 403 ⑥ 空集返回空 results。

**模块 1 · count（并入 `activity.test.ts`）**
- ① since 之后五表计数之和 ② since 之前不计入 ③ 未登录 401 ④ 空 since 返回总数。

**模块 5 · 媒体级声援（`mediaVote.test.ts`）**
- ① POST 成功（定位 active 请求，优先 PENDING 最早）② 幂等重复 ③ 自赞 400 ④ 同媒体多请求**按用户去重** ⑤ 无 `VOTE` 权限 403 ⑥ 无请求时 404 ⑦ GET 投票者列表隐私（请求人 + REQUEST_VIEW，其余 403）。

**模块 4 · F1 追更通知（`episodeNotification.test.ts`，mock `notificationManager`）**
- ① upsert 新集后聚合通知请求人 + 声援人（去重）② 一次扫描多集只发一条 ③ 同剧每日上限 1 条 ④ 文案含最新更新点。

**模块 4 · F2 追更中（`followingUpdates.test.ts`）**
- ① 返回我请求/声援剧的更新状态 ② 非本人且无 REQUEST_VIEW → 403 ③ 按 `latestEventAt` DESC。

**模块 4 · F3**：`/tv/:tmdbId` 详情响应含 `mediaInfo.recentEpisodes`（并入 `tv.test.ts`）。

**模块 6 · RECENT_VIEW 门控**：① recentlyadded 无权限 403 ② 默认权限模板含 RECENT_VIEW（`settings.test.ts`）。

**模块 7 · 头像（`avatar.test.ts`）**
- ① 上传 PNG 成功（存 `appDataPath/avatars`）② 非法 MIME 400 ③ 超大小 400 ④ 删除回退默认 ⑤ 代理 404 回退默认 SVG。

**模块 8 · 用户创建（`user.test.ts` 扩展，mock jellyfin client）**
- ① createEmby 成功后调用 `updateUserPassword` ② 显式密码/生成密码/无 Emby 三分支。

**模块 9 · MCP（`mcp.test.ts`）**
- ① 无 token 401 ② 令牌缺权限 → 工具 403 ③ `search_media` 正常返回 ④ `approve_request` 无 MANAGE_REQUESTS → 403。

**模块 10 · WeCom（`wecom.test.ts`，mock fetch）**
- ① `shouldSend` 未配置返回 false ② 发送成功（token 缓存复用）③ token 过期刷新重取。

**受 2.0 影响的现有测试**
- `activity.test.ts`：新增 count 端点用例（模块 1）。
- `vote.test.ts` / `request.test.ts`：保留现有请求级用例；媒体级声援另建新文件，不混改。
- 其余（`review/webhook/auth/issue`）：不受 2.0 影响，保持。

---

## 15. 验收标准（分模块）

### 模块 1
1. 侧栏「动态」未读计数 Badge 与 Discover 动态 Tab 标签红点出现/消失正确（进入动态 Tab 后清空）；count 接口无状态、参数生效。

### 模块 2
2. 吸顶 segmented「发现/动态」，`/?tab=activity` 完整动态流，刷新保持；切换保留滚动位置；`/activity` 重定向透传参数。
3. 侧栏高亮互斥：`/discover` 高亮 Discover、`?tab=activity` 高亮动态。
4. 动态 Tab 过滤切换为图标行 + 计数（方案 C），只看我独立开关；切换保留滚动位置。
5. 发现 Tab 顶部轮播 Hero（自动播放 + 圆点）；连载剧「已更新至」+「＋N 集」，已完结剧「已完结 · 全X季 · Y集」且无徽标，电影无状态行。
6. `DiscoverSliderType.RECENTLY_ADDED` 移除，`RecentlyAddedSlider` 不再出现；重扫幂等（`jellyfinEpisodeId` 去重）；删除剧集 CASCADE 清理。
7. ConnectionGuide：引导集成进**搜索下拉**（首次/空搜索显示三步，有结果只出媒体，首页无常驻横幅）；步骤 ② 显示 Emby/Jellyfin 类型提醒；步骤 ③ 登录账号用用户名字段。

### 模块 3
8. 本地季集结构来自 Episode 表（无 Emby 遍历）；`series_progress` 按季聚合正确；插件缺失回退不报错；季标题行进度徽标渲染。

### 模块 4
9. F1：新集入库后请求人/声援人收到 `EPISODE_UPDATED` 通知（一次扫描多集只发一条）；设置可单独开关。
10. F2：个人页「追更中」显示我请求/声援剧的最新更新状态，连载高亮、完结灰字。
11. F3：详情页季标题行出现「最近新增 E4–E6」chip，与进度/状态徽标并存，无新增不显示。
12. E3：轮播「查看全部」进入 `/discover/recentlyadded` 分页列表页，筛选与加载更多正常。

### 模块 5
13. 媒体详情页出现声援区（有请求时），点赞/取消幂等、自赞 400、刷新不丢失。
14. 媒体级接口聚合按用户去重；Hero/Discover 卡片声援徽标正确；SlideOver 声援者列表可见范围正确。

### 模块 6
15. 权限设置界面无 4K/非 4K 残留文案（zh_Hans / en）；死键已删。
16. 无 `RECENT_VIEW` 用户看不到轮播 Hero 与查看全部页；默认新用户含 `RECENT_VIEW`。

### 模块 7
17. Jellyfin/Emby 用户在头像位置显示真实头像（代理成功），本地用户显示默认；上传后可预览并全局生效，移除后回退。

### 模块 8
18. 「同时创建 Emby 账号 + 自动生成密码」后 Emby 可用该密码登录；Jellyfin 服务器也显示该勾选框。
19. 自动生成密码文案不再提及电子邮件，实际密码展示给管理员。

### 模块 9
20. openclaw 通过 MCP SSE 接入，工具集按权限校验可用；令牌可生成/吊销。

### 模块 10
21. 企业微信应用消息可推送核心事件通知；设置页可配置 corpid/secret/agentid/touser 并测试发送。

### 全量
22. `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` 全绿。

---

## 16. 工作量与风险

| 模块 | 主要风险 | 缓解 |
| --- | --- | --- |
| 1（count/红点） | localStorage 失效、多端重算 | 固定窗口可接受；共享 hook 侧栏 + Tab 双显示 |
| 2-A（双 Tab） | 高亮判定、prop 分支 | `asPath` 互斥 + 默认值对齐现状 |
| 2-B（Episode/扫描/端点/Hero） | recent scan 跳过早集、大库 upsert、滑块类型影响配置 | `processItem` 加 Episode 分支；跳过优化 + 批量插入；滑块移除同步清理设置映射 |
| 3（Episode 复用 + 插件 + 回退） | .NET 编译部署、双版本回退、依赖 2-B 合入 | 复用 schema 迁移 + 404 检测回退 |
| 4（通知/追更中/详情 chip/列表页） | **F1 为横切改动（约 10 agent 文件）**；F3 与模块 3 同文件冲突；端点膨胀 | F1 按横切规模排期；TvDetails 合并一次改；聚合服务函数复用 |
| 5（声援入口） | 媒体级聚合去重、自赞/隐私规则继承 | 按用户去重；复用 vote 现有幂等与可见范围 |
| 6（权限/文案） | locale 批量清理遗漏 | zh_Hans + en 先行，其余后续批量 |
| 7（头像） | 新依赖（multer）、路径安全、代理可用性 | MIME 白名单 + 大小上限 + 文件名安全化；代理失败回退默认 |
| 8（用户创建） | Emby API 版本差异、文案歧义 | createUser 后显式设密码；文案对齐实际行为 |
| 9（MCP） | 新依赖、工具鉴权、SSE 传输 | `@modelcontextprotocol/sdk` + 令牌映射权限 + 工具级校验 |
| 10（WeCom） | token 缓存、字段配置、API 版本 | 仿现有 agent；token 过期刷新；设置测试发送 |

---

## 17. 决策记录（汇总）

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 声援权限 | 挂 `Permission.VOTE`（默认模板含） |
| 2 | 短评权限 | 复用 `REQUEST`，不新增位 |
| 3 | 动态未读模型 | 固定窗口（前端 since），服务端无状态 |
| 4 | 首页动态预览 | **取消**（被双 Tab 取代），存在感由动态 Tab + 红点承担 |
| 5 | 探索页 Tab 机制 | URL query（`?tab=activity`） |
| 6 | /activity 去留 | 保留路由但重定向，导航改指向 |
| 7 | Tab 栏形态 | 吸顶 segmented（`sticky top-16 z-10`） |
| 8 | 切换滚动 | 保留各自位置 |
| 9 | ConnectionGuide | 仅发现 Tab 显示 |
| 10 | 侧栏高亮冲突 | **`router.asPath` 互斥判定**（动态项含 `tab=activity`，Discover 项不含） |
| 11 | Episode upsert | 只插不更 + `ON CONFLICT DO NOTHING` |
| 12 | 聚合接口 | 新端点 `recentlyadded`（含 `newEpisodes` 明细），不动 `/api/v1/media` |
| 13 | Hero 展示形态 | 顶部轮播（16:7，自动播放 + 箭头 + 圆点） |
| 14 | Hero 与滑块关系 | **移除 `DiscoverSliderType.RECENTLY_ADDED`**，Hero 为唯一出口 |
| 15 | 连载剧展示 | 「已更新至 第X季 第Y集」+「＋N 集」 |
| 16 | 已完结剧展示 | **「已完结 · 全X季 · Y集」（方案 B）**，隐藏徽标 |
| 17 | 完结判定数据源 | 前端按需拉 `/api/v1/tv/:tmdbId`；两口径各司其职（TMDB 官方 / Episode 本地） |
| 18 | 剧集更新时间窗 | `days` 默认 7 天 |
| 19 | 进度边界 | 播放数据层走插件 API；媒体库层直连 Emby 原生 |
| 20 | 进度季集结构 | **复用模块 2-B 的 Episode 表**，删除原结构缓存设计 |
| 21 | 进度老数据 | 不回填，自然增量 |
| 22 | 进度插件交付 | fork + 独立发版 .dll，Sinerr 检测接口回退 |
| 23 | 进度两步序 | 先本地（Episode 表 + 进度缓存）→ 再插件聚合 API |
| 24 | recent scan 跳过早集 | **`processItem` 加 Episode 分支**按 SeriesId 走 processShow |
| 25 | Episode 新鲜度 | webhook 触发（`library.new`/`item.updated`）+ 5 分钟轮询兜底 |
| 26 | recentlyadded 查询 | GROUP BY 单查询替代 EXISTS + 相关子查询 |
| 27 | 追更通知触发 | 批量插入后显式聚合通知，不走 subscriber；防轰炸（同剧每日 1 条） |
| 28 | 追更通知事件 | `Notification.EPISODE_UPDATED = 16384`，`UserSettings` 可单独开关；**横切 ~10 个 agent** |
| 29 | F2/F3/E3 | 复用 recentlyadded 聚合逻辑 + Episode 表，不建新表 |
| 30 | 未读红点位置 | 共享 `useActivityUnreadCount` hook，**侧栏 + Discover 动态 Tab 标签双显示** |
| 31 | F2 隐私 | 仅**本人 + 管理员 + `REQUEST_VIEW`** 可见 |
| 32 | 共享算法 | 「最新更新点」抽 `computeLatestPoint`；聚合抽服务函数，`recentlyadded`/`following-updates` 两端点复用 |
| 33 | TvDetails 合并改 | 模块 3 进度徽标 + 模块 4 F3 新增 chip 同一次提交 |
| 34 | F1 通知触发 | **批量插入后显式聚合通知**（不走 subscriber），一次查询新增集 mediaId |
| 35 | F3 数据源 | **并入 `/tv/:tmdbId` 详情响应**（mediaInfo.recentEpisodes），不建新端点 |
| 36 | Episode 索引 | 加 `IDX_EPISODE_MEDIA_SEASON`(mediaId, seasonNumber) |
| 37 | count 实现 | UNION ALL 合成一条，替代 5 次 COUNT |
| 38 | 声援入口 | **VoteButton 组件化 + 媒体级接口**（`/media/:tmdbId/:mediaType/vote`），详情页为主入口，Hero/卡片/SlideOver 多入口 |
| 39 | 媒体级声援聚合 | **按用户去重**（同媒体多请求）；自赞 400 / 幂等 / 点赞者隐私规则全部继承 |
| 40 | 权限文案 4K | 清理 `zh_Hans` / `en` 的 PermissionEdit 4K 死键与「非 4K」限定 |
| 41 | RECENT_VIEW 门控 | `recentlyadded` 端点 + Hero + E3 用 `isAuthenticated(Permission.RECENT_VIEW)`；默认模板含 RECENT_VIEW |
| 42 | 头像显示 | `getUserAvatarUrl()` 返回 `/avatarproxy/{jellyfinUserId}`；avatarproxy 流式代理 `/Users/{id}/Images/Primary`，失败回退默认 |
| 43 | 头像上传 | `POST/DELETE /user/:id/avatar`（本人或 MANAGE_USERS），存 `<appDataPath>/avatars/`；引入 `multer`（评审点） |
| 44 | 头像优先级 | 本地上传 > Jellyfin 头像 > 默认剪影 |
| 45 | 引导位置 | **方案 A：搜索下拉集成**——首次/空搜索时显示于搜索结果上方，首页移除常驻横幅；placeholder 弱引导「搜索影视 · 三步开始观看」 |
| 46 | 服务器类型提醒 | **步骤 ②（连上服务器）**按 `mediaServerType` 提示「服务器类型请选择 Emby/Jellyfin（选错无法连接）」；演示弹窗加类型字段 |
| 47 | 引导步骤 ③ | 登录账号用 `jellyfinUsername \|\| username`（用户名字段），不用 displayName/昵称；无「记住我」 |
| 47b | 引导文案定稿 | 「三步开启观影」：① 装好客户端 ② 连上服务器 ③ 登录即看；一键复制全部信息 |
| 48 | Emby 账号密码 | `createUser` 后新增 `updateUserPassword(userId, newPassword)`（`POST /Users/{id}/Password`）显式设密码；UI 勾选框放宽到 `EMBY \|\| JELLYFIN` |
| 49 | 自动生成密码文案 | 改为「创建后展示给管理员（无需电子邮件）」；`passwordinfodescription` 死文案删除/更新 |
| 50 | MCP 服务 | HTTP + SSE（`/api/v1/mcp`）+ Bearer 令牌映射权限；依赖 `@modelcontextprotocol/sdk` |
| 51 | 企业微信渠道 | **应用消息 API**（corpid/corpsecret/agentid/touser），新 agent `wecom.ts` |
| 52 | PG 兼容 | recentlyadded 的 `newEpisodes` 聚合走**应用层组装**（两查询内存归并），规避 sqlite/pg 的 JSON 聚合方言差异 |
| 53 | 镜像优化 | runtime 选择性 COPY（去掉 `COPY . .` 源码）+ `.dockerignore` 追加 `*.map`/coverage；standalone 因自定义服务端不适用 |
| 54 | standalone 评估 | **采纳方案 2**：`@vercel/nft` 追踪 `dist/index.js` 精准裁剪运行时依赖（保留 pnpm 布局 + 原生模块 allowlist + fs 文件手动补齐），预估 node_modules -30~50%；不采用完整 standalone 重写 |
| 55 | 动态过滤 UI | **方案 C**：类型过滤用图标行 + 计数徽标，只看我独立右侧开关（替换 pill 混排） |
| 56 | 测试策略 | 抽 `server/test/helpers.ts` 共享基建 + 服务层直测（module mock）+ 鉴权矩阵化 + **sqlite/pg 双跑核心查询** + e2e 分层 + 核心端点覆盖率 ≥80% |

---

## 18. 实施计划

1. **阶段零 · 模块 6**：权限文案 4K 清理 → RECENT_VIEW 门控（端点 + 默认模板）→ i18n → 全绿。
2. **阶段一 · 模块 2-A**：ActivityList 组件化 → Discover 双 Tab → 导航/重定向 + `asPath` 高亮 → **ConnectionGuide 引导优化（搜索下拉集成 + 类型提醒 + 步骤 ③ 修正 + 文案定稿）** → i18n → 全绿。
3. **阶段二 · 模块 2-B**：Episode 实体+迁移 → 扫描 upsert（含 `processItem` Episode 分支）→ **聚合服务函数 + `computeLatestPoint` 共享工具** → `recentlyadded` 端点（GROUP BY + RECENT_VIEW）→ Hero 组件 → 移除 RECENTLY_ADDED 滑块 → i18n → 全绿。
4. **阶段三 · 模块 1**：count 端点 → `useActivityUnreadCount` hook（侧栏 + 动态 Tab 标签）→ i18n → 全绿。
5. **阶段四 · 模块 3**：本地季集结构（复用 Episode 表）→ 插件 fork（列 + 聚合 API）→ Sinerr 查询改造 + 回退 → 前端进度徽标（与 F3 合并改 TvDetails）→ 全绿。
6. **阶段五 · 模块 4**：F1 追更通知（枚举 + **全部 agent 分支** + 批量后显式聚合通知 + 防轰炸）→ F2 追更中端点/区块 → F3 详情页 chip（并入 `/tv/:tmdbId`，与模块 3 合并改）→ E3 查看全部页 → i18n → 全绿。
7. **阶段六 · 模块 5**：媒体级声援接口（`/media/:tmdbId/:mediaType/vote` + 按用户去重）→ `VoteButton` 组件化 → 详情页声援区 → Hero/卡片徽标 → SlideOver 声援区 → i18n → 全绿。
8. **阶段七 · 模块 7**：avatarproxy 代理真实头像 → `getUserAvatarUrl()` 修正 → 上传/删除端点（multer + 存储 + 校验）→ `UserGeneralSettings` 头像区块 → i18n → 全绿。
9. **阶段八 · 模块 8**：`updateUserPassword` + createEmby 分支显式设密码 → 勾选框放宽 EMBY/JELLYFIN → 自动生成密码文案 → i18n → 全绿。
10. **阶段九 · 模块 9**：MCP 令牌与设置 → `/api/v1/mcp`（SSE/HTTP + sdk）→ 工具集 + 权限映射 → i18n → 全绿。
11. **阶段十 · 模块 10**：`wecom.ts` agent + token 缓存 → 设置页配置/测试 → i18n → 全绿。
12. **横切**：模块 2-B 的 recentlyadded 聚合按**应用层组装**实现（PG 兼容，决策 52）；Dockerfile runtime 选择性 COPY + `.dockerignore` 扩充（决策 53），随任一合入时附带。
13. **横切·镜像瘦身（方案 2，决策 54）**：`@vercel/nft` devDep + `scripts/trace-server.mjs`（布局保留 + natives allowlist + fs 手动补齐）→ Dockerfile 移除 prod-deps 阶段、runtime 只拷 `runtime-stage/.next/public` → 验证可启动 + 体积对比 → 随任一合入时附带。
14. **横切·测试优化（决策 56）**：先落 `server/test/helpers.ts` 共享基建（阶段一前），随后各模块测试按 §14 用例清单随阶段落地；CI 加 postgres service 双跑核心查询。

---

## 19. 待评审点

| # | 问题 | 倾向 |
| --- | --- | --- |
| 1 | 轮播 auto-play 频率 | 6s，后续可做成设置项（本轮不做） |
| 2 | 模块 3 插件交付周期 | fork 仓库单独排期，Sinerr 侧先落 Episode 表本地查询 |
| 3 | 移除 RECENTLY_ADDED 对已保存滑块配置的影响 | 存量配置含该类型时忽略渲染，管理界面不可再选择；升级脚本可清理 |
| 4 | 其余 40+ 语言文件的 4K 残留 | 仅活跃键「非 4K」限定后续批量清理，本轮只做 zh_Hans + en |
| 5 | 头像上传依赖 | 引入 `multer`（标准 multipart） vs 手写解析避免依赖；倾向 multer |
| 6 | 头像下拉配额圆环（可选小项） | 管理员不显示配额但首次打开仍闪加载圆环；若顺手修复，`UserDropdown` 对 `MANAGE_USERS` 用户不挂载 `MiniQuotaDisplay`（省请求 + 消闪烁）。收益低，可后置 |
| 7 | 企业微信「参考 mp」 | 仓库内无 mp 实现，按标准企业微信应用消息 API 设计 |
