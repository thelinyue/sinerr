# Emby 播放进度二次开发设计文档

> 状态：设计评审中（未开始编码）
> 目标版本线：Sinerr `v1.7.x`；Emby 插件 `PlaybackReporting` fork 独立维护
> 前置：Sinerr 侧合并前必须通过 `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build`

本文档描述为「剧集按季展示观看进度」以及后续播放相关功能，对 Emby 侧
Playback Reporting 插件（下称「插件」）做最小二次开发，并配套修改 Sinerr
的数据查询与展示。核心目标是**消除 Sinerr 遍历季集 API 的性能瓶颈**，并让
「按季/按集进度」一次查询即可获得。

**执行策略：分两步、可独立发布。**
- **第一步（方案 D，纯 Sinerr 侧）**：季/集结构缓存 + 进度缓存，先缓解性能，零 Emby 改动，独立发版。
- **第二步（方案 B，插件 + Sinerr）**：fork 插件加结构列与聚合 API，Sinerr 升级为一次接口查询，获得按季进度。

---

## 1. 背景与目标

### 1.1 现状

| 环节 | 现状 | 问题 |
| --- | --- | --- |
| 进度数据源 | Playback Reporting 插件的 `PlaybackActivity` 表（Emby 服务器本地 SQLite） | 表里只有 `ItemId`（Emby 内部 ID），**无季号/集号/tmdbId** |
| Sinerr 查询路径 | `getUserPlaybackActivity()` 一次 SQL 查已看集 → 但前置需遍历 `getSeasons` + 每季 `getEpisodes` 拿 episodeIds | 一部 3 季剧 = 4 次 Emby HTTP；10 季 = 11 次；**每次打开详情页重跑，无缓存** |
| 进度展示 | 短评区顶部「已看 x/y 集」为整剧维度 | 无法按季/按集展示 |
| 评论人进度 | 用 Sinerr 本地 `PlaybackEvent`（webhook 写入） | 剧集去重只保留最新一集，**无法算「已看 x/y」** |

### 1.2 需求

1. **剧集详情页季标题行**显示「该季已看 x/y 集」，整季看完用绿色勾标识。
2. 消除 Sinerr 对季集结构的遍历式查询（性能瓶颈）。
3. 为后续功能预留结构数据：每集进度、续看推荐、季级聚合报表。

### 1.3 非目标

- 不改动插件现有报表页面与行为。
- 不把播放进度全量同步进 Sinerr 本地表（保持「Emby 为唯一事实源」）。
- 不做「关注/好友」等社交扩展。

---

## 1.4 边界原则：插件统一「播放数据层」，Emby 原生负责「媒体库层」

Sinerr 与 Emby 的集成按数据性质划清边界，避免过度收敛：

| 层 | 数据/能力 | 出口 | 理由 |
| --- | --- | --- | --- |
| **播放数据层** | 播放历史、观看统计、观看进度（按季/集）、播放时长 | **统一走插件语义化 API** | 插件在 Emby 进程内本地计算，Sinerr 一次 HTTP 拿聚合结果；不暴露 SQL、不遍历季集、不跨网多次往返 |
| **媒体库层** | 登录/鉴权、用户列表、媒体库、媒体项详情、季/集结构（元数据）、海报图片 | **直连 Emby 原生 API** | 成熟稳定的原生能力，已成熟调用；收敛到插件纯增风险无收益（插件依赖 Emby 版本，升级不同步会连带基础功能不可用） |

**边界判据**：凡是「播放历史 / 统计 / 进度」→ 插件；凡是「媒体库本身（元数据、结构、登录、图片）」→ Emby 原生。

**不走的弯路**：
- 不把「所有 Emby 数据」收敛进插件（登录/库/媒体/图片保持直连）。
- 不把进度全量同步进 Sinerr 本地表当作主路径（保持 Emby 为唯一事实源；Sinerr 本地 `PlaybackEvent` 仅用于 webhook 驱动的「评论人进度」展示，见 §4.4）。

> 注：本原则确立于设计评审（决策记录 §9 第 5 项）。

---

## 2. 方案对比与选型

| 方案 | 插件改动 | Sinerr 改动 | 效果 | 评价 |
| --- | --- | --- | --- | --- |
| A. 结构列扩展 | 加 3 列 + 1 处填充 | 查询按季分组，但总集数仍需遍历/缓存 | 进度可聚合 | 半程方案，总集数问题未根治 |
| B. 插件列 + 聚合 API | 加 3 列 + 填充 + 1 个 API | 调 1 次接口拿「总集数+已看集数」 | **一次查询，总集数实时** | **最终方案** |
| C. 插件推 webhook | 播放停止时 POST Sinerr | 复用现有 webhook | 事件驱动 | **不推荐**，与现有 webhook 重复 |
| D. 仅 Sinerr 缓存 | 无 | 季/集结构缓存 24h + 进度缓存 60s | 消除重复遍历 | **第一步**，零 Emby 改动 |

**结论**：
- 插件侧走 **方案 B**：结构列（让已看集数可聚合）+ 聚合 API（总集数由插件在 Emby 进程内用本地内存计算，零网络开销、无需缓存、实时）。
- Sinerr 侧第一步先落 **方案 D**：纯缓存独立发版，立即缓解性能；第二步接插件 API。
- 方案 C 不采用（与现有 webhook 机制重复）。

---

## 3. 第一步（方案 D）：Sinerr 纯缓存

> 独立可发布，不需要 Emby 侧任何操作。

### 3.1 结构缓存（季/集结构）

- key：`series-structure-{seriesId}`
- value：`[{ seasonNumber, episodeIds: string[] }]`
- TTL：24h
- 目的：把「getSeasons + N 次 getEpisodes」的 N+1 次 HTTP 压成**首次 1 次**，之后全走缓存。
- 失效：Emby 侧新增/删除剧集会延迟反映（24h）——评审点 2 已确认，由插件 API（第二步）彻底解决。

### 3.2 进度缓存（已看集数）

- key：`series-progress-{userId}-{seriesId}`
- value：已看集数聚合
- TTL：60s
- 目的：播放停止后 Emby 写入，60s 内展示旧值可接受。

### 3.3 实现

- 复用现有 `node-cache` 基建（`server/api/externalapi.ts` 已有 NodeCache 用法）。
- 该步不改变响应结构（仍为整剧 `watchedEpisodes/totalEpisodes`），只是内部查询被缓存加速。

---

## 4. 第二步（方案 B）：插件改造 + Sinerr 升级

### 4.1 插件数据模型变更

`PlaybackActivity` 表新增 3 个可空列：

```sql
ALTER TABLE PlaybackActivity ADD SeriesId TEXT;        -- 剧集（Series）ItemId
ALTER TABLE PlaybackActivity ADD SeasonId TEXT;        -- 季（Season）ItemId
ALTER TABLE PlaybackActivity ADD ParentIndexNumber INT; -- 季号（s01 的 1）
```

复用插件现有 schema 自动迁移机制（`ActivityRepository.Initialize()` 的
`required_fields` + `add_missing_sql`，见 `ActivityRepository.cs:236-262`），
把三列加进 `required_fields` 即可，**老库升级自动执行，不重建表**。

### 4.2 填充逻辑

`EventMonitorEntryPoint.GetPlaybackInfo()`（`EventMonitorEntryPoint.cs:224`）
在 `PlaybackInfo` 落库前，从 `session.NowPlayingItem`（`BaseItemDto`）填充：

```
SeriesId             = NowPlayingItem.SeriesId
SeasonId             = NowPlayingItem.SeasonId
ParentIndexNumber    = NowPlayingItem.ParentIndexNumber
```

- `BaseItemDto` 已包含 `SeriesId / SeasonId / ParentIndexNumber`（插件自身的
  `GetItemName` 已在用 `ParentIndexNumber` 拼 "s01e02" 文件名）。
- `PlaybackInfo` 类同步加 3 个属性，`ActivityRepository` 的
  INSERT / UPDATE（`AddPlaybackAction` / `UpdatePlaybackAction`）带上新列。
- 电影/音频等其他类型这三列为空，不影响现有逻辑。

### 4.3 聚合 API（核心，替代 Sinerr 侧缓存总集数）

在 `UserActivityAPI.cs` 新增路由，供 Sinerr 一次调用拿整部剧的按季进度：

```
GET /user_usage_stats/series_progress/{seriesId}?userId={userId}
→ {
    seriesId,
    seasons: [
      { seasonNumber, total, watched }
    ]
  }
```

实现思路（插件进程内本地计算，无网络开销）：
- **total**：`_libraryManager` 查询该 series 下各季的 Episode 数（`GetItemList` 本地内存，参考现有 `GetChildStats` 写法 `UserActivityAPI.cs:344`）。
- **watched**：查 `PlaybackActivity`，`WHERE UserId=? AND SeriesId=? AND ParentIndexNumber=? GROUP BY ItemId`（依赖新增的 `ParentIndexNumber` 列）。
- **total 实时**：因为 total 是每次从 Emby 本地拿，**无 24h 缓存过期问题**——这就是方案 B 优于「A + 结构缓存」的根本原因。

### 4.4 老数据（评审点 1：不做回填）

- 新列对历史记录为空 → `ParentIndexNumber IS NULL` 不计入按季聚合。
- **确认不做回填**：自然增量即可，新记录逐步带全字段；整剧进度统计不受影响。

---

## 5. Sinerr 侧查询与展示（第二步后）

### 5.1 查询改造

`server/api/jellyfin.ts` 新增方法：

```ts
public async getSeriesProgress(
  userId: string,
  seriesId: string
): Promise<{ seasonNumber: number; total: number; watched: number }[]>
```

调插件 `series_progress` 接口，替换原「遍历季集 + 整剧统计」逻辑。插件未升级
（接口 404）时**回退**到第一步的缓存 + 遍历逻辑，兼容双版本。

### 5.2 接口变更

`server/routes/user/index.ts` 的 `/user/:id/media/:tmdbId/:mediaType/playback`
剧集分支返回增加：

```ts
seasons?: { seasonNumber: number; watchedEpisodes: number; totalEpisodes: number }[]
```

保留顶层 `watchedEpisodes/totalEpisodes/watchedPercent`（兼容现有调用方，
如短评区整剧进度）。

### 5.3 前端展示

`src/components/TvDetails/index.tsx` 季标题行（`Disclosure.Button` 右侧状态徽标区，
当前 `mSeason?.status` 系列条件渲染旁）**追加进度徽标**：

- 数据：TvDetails 页请求 `/playback` 拿 `seasons[]`，用现有 `useSWR` 缓存。
- 展示：`第{n}季 已看 x/y`；`x === y` 时整季绿勾「已看完」。
- 不替换原有「部分可观看/可观看」状态徽标（语义不同：状态=可看性，进度=我看了多少）。

---

## 6. 兼容性

| 场景 | 行为 |
| --- | --- |
| 插件已升级（有列 + API） | `series_progress` 一次查询按季聚合，实时 |
| 插件未升级（无 API） | 回退第一步缓存 + 遍历 + 整剧统计 |
| 电影 | 不受影响（走 Movie 分支，无季概念） |
| 老数据（新列 NULL） | 不计入按季聚合，整剧进度仍可统计 |
| 多用户 | 每个用户独立进度缓存 key，互不污染 |

---

## 7. 测试与验收

### 插件侧（手工 + 用户侧）
- [ ] 升级插件后 `PlaybackActivity` 表出现 3 个新列。
- [ ] 播放一集后该行带 `SeriesId/SeasonId/ParentIndexNumber`。
- [ ] `series_progress` 接口返回每季 total + watched。

### Sinerr 侧（`pnpm test`）
- [ ] 第一步：结构/进度缓存命中与过期测试。
- [ ] 第二步：`getSeriesProgress` 单元测试（mock 插件返回，按季聚合正确）。
- [ ] `/playback` 接口返回 `seasons[]`，结构与顶层字段兼容。
- [ ] 插件缺失时回退旧逻辑不报错。
- [ ] 前端季标题行进度徽标渲染。
- [ ] 全绿：`pnpm test` / `typecheck` / `lint` / `build`。

---

## 8. 工作量与风险

| 项 | 规模 | 风险 | 缓解 |
| --- | --- | --- | --- |
| 第一步 Sinerr 缓存（D） | ~2 文件 | 缓存失效延迟 | 结构 24h / 进度 60s，第二步根治 |
| 插件 3 列 + 填充 + API（B） | ~5 文件 | 需 .NET 编译 + 部署 .dll 到 Emby | 复用现有 schema 迁移，不动报表逻辑 |
| Sinerr 查询改造 + 回退 | ~3 文件 | 双版本回退逻辑 | 接口 404 检测 + 空值回退 |
| 前端徽标 | 1 文件 | 与现有状态徽标重叠 | 追加而非替换 |

---

## 9. 决策记录

| 决策点 | 结论 |
| --- | --- |
| 1. 老数据回填 | **不做**，自然增量 |
| 2. 总集数来源与缓存 | **改由插件 API 计算**（方案 B），实时、无缓存过期；第一步 D 的 24h 结构缓存仅为过渡 |
| 3. 插件交付形式 | **fork + 独立发版 .dll**，Sinerr 侧检测接口可用性并回退 |
| 4. 开发顺序 | **先 D（纯缓存独立发版）→ 再 B（插件 + Sinerr）**，两步解耦 |
| 5. 边界原则 | **播放数据层走插件 API；媒体库层（登录/库/媒体/图片）直连 Emby 原生**（见 §1.4） |
