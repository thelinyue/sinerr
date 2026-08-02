# 社交玩法功能设计文档

> 状态：设计评审中（未开始编码）
> 目标版本线：`v1.7.x`（遵循仓库发布硬约束）
> 前置：合并前必须通过 `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build`

本文档描述 Sinerr 在现有「请求-审批」核心链路上扩展社交玩法的完整设计方案，按阶段拆分，每个阶段均可独立评审、独立合入。

---

## 1. 背景与目标

### 1.1 现状盘点

当前产品已具备的社交相关基础：

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 用户体系 | `server/entity/User.ts` | 头像、`displayName`、`/users/:id` 个人页、加入时间、Jellyfin 账号 |
| 请求记录 | `server/entity/MediaRequest.ts` | `requestedBy` 标记请求人，`RequestCard` 已展示请求人头像 |
| Issue + 评论 | `server/entity/Issue.ts` / `IssueComment.ts` | 已存在成熟的「主题 + 评论串」数据模型与路由，可作为新互动的范式参考 |
| 发现页请求流 | `src/components/Discover/RecentRequestsSlider` | 首页已有「最新请求」区块 |
| 用户最近观看 | `server/routes/user` | `recentlyWatched`（来自 Jellyfin 播放记录） |

### 1.2 关键线索：`VOTE` 权限已预留但未使用

`server/lib/permissions.ts:8` 中 `VOTE = 64` 已定义，但**全仓库没有任何一处使用**（`Permission.VOTE` 无匹配）。上游 Overseerr 曾规划「请求点赞」后移除，权限位遗留。这为阶段 1 提供了零成本权限接入点。

### 1.3 设计目标

1. **参与感**：非请求人也能表达「我也想看」，参与决策与讨论。
2. **低侵入**：不破坏现有请求-审批主流程，新功能全部为增量。
3. **可迭代**：三个阶段独立可交付，避免一次性大改动。
4. **隐私友好**：社交信息的可见性默认保守，仅本人 + 管理员可见的历史行为不默认公开。

### 1.4 非目标（本方案明确不做）

- 关注 / 好友关系、私信聊天
- 观影会 / 一起看（Watch Party）等实时协作
- 面向公网的全量公开社区（本产品是私有媒体请求工具，受众是家庭/小团队）

---

## 2. 总体架构

### 2.1 分层结构

所有社交功能遵循现有代码分层：

```
server/entity/          TypeORM 实体（含 migration 对应列）
server/interfaces/api/  请求/响应类型定义
server/routes/          路由（isAuthenticated + Permission 鉴权）
server/lib/notifications 通知枚举与投递（新增事件类型）
src/components/          前端组件（RequestCard / 个人页 / 发现页）
src/i18n/                文案（zh-CN / en 同步）
sinerr-api.yml           OpenAPI 契约（新增端点）
server/migration/{sqlite,postgres}/  双库迁移脚本
```

### 2.2 权限策略

- 新互动行为统一挂在 `Permission.VOTE`（已存在，权限值 64）。
- 默认权限模板 `settings.main.defaultPermissions` 中**不默认包含** VOTE？—— 评审点：需确认是否把 VOTE 加入默认权限，否则新用户默认无点赞能力。建议：加入默认权限（因为它是「低风险表达性操作」，同 `REQUEST`）。

### 2.3 数据模型约定

参考 `IssueComment` 与 `watchlist` 表结构，新表遵循：
- `id` 主键自增
- `createdAt` / `updatedAt` 时间戳
- 关联用户用 `@ManyToOne(() => User, { eager: true })`
- 唯一约束用 `@Index(..., { unique: true })`
- 同时生成 sqlite 与 postgres 两套迁移（命名遵循现有时间戳前缀格式）

---

## 3. 阶段 1：请求声援（Request Vote）

### 3.1 目标

解决「这部片子不是我求的，但我很想要」的表达缺失。任何有 VOTE 权限的用户可以给某条请求点「我也想看」，请求者收到通知，点赞头像聚合展示。

### 3.2 数据模型

新增实体 `server/entity/RequestVote.ts`：

```ts
@Entity()
@Index('IDX_REQUEST_VOTE_USER', ['request', 'user'], { unique: true })
class RequestVote {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => MediaRequest, (request) => request.votes, {
    onDelete: 'CASCADE',
  })
  @Index()
  public request: MediaRequest;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;
}
```

`MediaRequest` 增加关联与聚合字段：

```ts
@OneToMany(() => RequestVote, (vote) => vote.request, { cascade: true })
public votes: RequestVote[];

// 非 DB 字段，仅用于响应
public voteCount?: number;
public userVoted?: boolean;
```

### 3.3 API 设计

路由文件：新建 `server/routes/vote.ts`，挂载于 `server/routes/index.ts`：

```
POST   /api/v1/request/:requestId/vote        # 点赞（幂等：已点则返回当前状态）
DELETE /api/v1/request/:requestId/vote        # 取消赞
GET    /api/v1/request/:requestId/votes       # 获取点赞用户列表（头像聚合用）
```

请求/响应：

```ts
// voteInterfaces.ts
export interface RequestVoteResponse {
  voteCount: number;
  userVoted: boolean;
}
```

鉴权规则：
- 点赞/取消：`isAuthenticated(Permission.VOTE)`。
- 查看点赞用户列表：请求者本人或 `REQUEST_VIEW` 权限（避免过度暴露，见隐私章节）。
- 不允许给自己的请求点赞（`request.requestedBy.id === req.user.id` 时返回 400）。

幂等与事务：
- 用 `dataSource.transaction` + 唯一索引兜底并发重复点赞（参考 `registerPushSubscription` 的事务写法）。
- 重复点赞返回 200 + 当前状态（幂等），不报错。

### 3.4 通知

`server/lib/notifications/index.ts` 新增枚举：

```ts
REQUEST_VOTED = 8192,
```

- 通知触发点：`RequestVote` 的 `@AfterInsert()`（参考 `MediaRequest.notifyNewRequest`）。
- 通知对象：请求人（`request.requestedBy`）。
- 推送文案示例：「{displayName} 也想看《{title}》」。
- 需要同步：`getAdminPermission` 无需改（该事件不发管理员）；`UserSettings.notificationTypes` 的 `ALL_NOTIFICATIONS` 计算会自动包含新枚举（它是 `Object.values(Notification)` 累加）。

### 3.5 前端改动

1. **`RequestCard`**（`src/components/RequestCard/index.tsx`）：
   - 在卡片底部操作区新增「声援」按钮（`HeartIcon` / `ThumbUpIcon`），点击调 `POST/DELETE /vote`。
   - 按钮旁展示 `voteCount` 数字与最近 3 位点赞用户头像（`CachedImage type="avatar"`）。
   - 已赞态高亮（类似 `useUser` 的 isUpvoted 状态），乐观更新 + 回滚（参考现有 `modifyRequest` 的 optimistic pattern）。

2. **请求详情 / 媒体详情页**（后续可在 `ManageSlideOver` 或媒体页操作区复用同一组件）——阶段 1 先只做 RequestCard，不做展开。

3. **i18n**：`defineMessages` 新增文案，zh-CN 与 en 同步补齐。

### 3.6 迁移脚本

- sqlite：`server/migration/sqlite/<timestamp>-AddRequestVote.ts`（仿 `1682608634546-AddWatchlists.ts`，重建表 + 唯一索引）。
- postgres：`server/migration/postgres/<timestamp>-AddRequestVote.ts`（仿 `AddWatchlists` 的 PG 版本）。
- 时间戳用当前日期生成，两个库可不同但需保证顺序在现有最新迁移之后。

### 3.7 测试

- `server/test` 现有请求路由测试（`request.test.ts`）补充：
  - 点赞成功、重复点赞幂等、取消点赞。
  - 无 VOTE 权限 403。
  - 给自己请求点赞 400。
- 用 `pnpm test` 全量回归。

### 3.8 验收标准

1. 有 VOTE 权限的用户可对任意非本人请求点赞/取消。
2. 点赞数实时反映在 RequestCard，刷新不丢失。
3. 请求者收到 REQUEST_VOTED 通知。
4. `pnpm test` / `typecheck` / `lint` / `build` 全绿。

---

## 4. 阶段 2：用户动态信息流（Activity Feed）

### 4.1 目标

让首页从「媒体推荐」扩展到「社群动态」：谁请求了什么、谁声援了谁、最近有什么新动作。

### 4.2 设计决策：不落新表，聚合查询

优先复用现有表做聚合查询（`request` / `vote` / `issue` 变更时间戳），避免为信息流单独维护一张「activity」表带来的写入同步与清理成本。若后续数据量大再考虑物化。

统一响应结构：

```ts
export interface ActivityItem {
  id: number;
  type: 'request' | 'vote' | 'issue';
  createdAt: Date;
  actor: { id: number; displayName: string; avatar: string };
  payload: {
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
    title?: string;
    requestId?: number;
  };
}
```

### 4.3 API

```
GET /api/v1/activity?take=20&skip=0
```

- 鉴权：`isAuthenticated()`（登录即可见，但内容过滤见隐私章节）。
- 实现：三次分页查询（request 按 createdAt DESC、vote 按 createdAt DESC、issue 按 createdAt DESC），内存中按时间归并取 top N。
- 详情字段（title/海报）由前端复用现有 `useSWR` 拉取（与 `UserProfile` 的 `updateAvailableTitles` 模式一致），服务端只回 tmdbId。

### 4.4 前端

- `src/components/Discover` 新增 `ActivityFeed` 区块，插到首页 `Discover` 现有滑块之后。
- 卡片样式复用 `RequestCard` 的视觉语言；vote 类型显示「{user} 想看了 {title}」。
- 移动端折叠，桌面端 3 列网格或单列时间线（评审定）。

### 4.5 隐私控制

- 阶段 2 的 activity 只聚合：请求、声援、Issue 报告——这些行为在现有产品中已默认对「有请求查看权的人」可见，不新增暴露。
- **观看记录（recentlyWatched）不进信息流**，保持「本人 + ADMIN」可见的现状，避免默认公开观看历史。
- 后续如需「好友可见」，再单独加 `UserSettings` 开关字段。

### 4.6 验收标准

1. 首页出现动态区块，包含请求/声援/Issue 三类动作。
2. 分页滚动正常，接口响应 < 200ms（聚合查询 + 无 N+1）。
3. 隐私边界符合 4.5。

---

## 5. 阶段 3：媒体短评 + 轻游戏化（可选、后置）

### 5.1 媒体短评（Media Review）

- 新实体 `MediaReview`（复用 `IssueComment` 结构 + 评分字段 `rating int 1-5`）。
- 媒体详情页新增短评区（1-5 星 + 一句话），鉴权用 `REQUEST` 或新 `REVIEW` 权限（评审定）。
- 排序：按时间 DESC；只展示登录用户可见内容。

### 5.2 成就 / 徽章（轻游戏化）

- 不落新表，按需计算：请求数、Issue 解决数、获赞数阈值。
- 个人页 `ProfileHeader` 下展示徽章行。
- 数据来源：`User.getQuota` / `requestCount` / 阶段 1 的 `voteCount` 聚合。

### 5.3 验收标准（阶段 3）

1. 媒体页短评可发可看，星级评分展示。
2. 个人页徽章随数据自动更新，无手动配置。

---

## 6. 横切关注点

### 6.1 数据库兼容

- 全部新表同时生成 sqlite 与 postgres 迁移。
- `DbAwareColumn` 处理 datetime 类型差异（sqlite `datetime` / pg `timestamp with time zone`）。

### 6.2 i18n 规范

- 新文案统一走 `defineMessages`，zh-CN 为主文案，en 同步翻译（仓库惯例：默认简体中文）。
- 提交信息用中文 subject（commitlint 硬约束：不以 ASCII 大写开头）。

### 6.3 性能

- 阶段 1 点赞按钮计数用请求内联（`loadRelationCountAndMap`），避免对 `MediaRequest` 列表接口做 N+1。
- 阶段 2 聚合查询控制在 3 个有索引的 `createdAt` 排序查询。

### 6.4 隐私默认值（评审重点）

| 数据 | 默认可见范围 | 说明 |
| --- | --- | --- |
| 请求 / 声援 / Issue | 登录用户 | 与现状一致，不新增暴露 |
| 观看记录 recentlyWatched | 本人 + ADMIN | 保持现状，不进信息流 |
| 点赞用户头像列表 | 请求人 + `REQUEST_VIEW` | 避免向所有人暴露点赞者身份 |

### 6.5 发布流程

按仓库 `AGENTS.md`：功能提交用 Conventional Commits，subject 中文开头；合入 `release` 分支前 `pnpm test && pnpm typecheck && pnpm lint && pnpm build` 全绿；版本线固定 `v1.7.x`。

---

## 7. 工作量与风险

| 阶段 | 预估规模 | 主要风险 | 缓解 |
| --- | --- | --- | --- |
| 1 请求点赞 | ~6 文件（实体/路由/通知/卡片/迁移×2/测试） | 并发重复点赞 | 唯一索引 + 事务 |
| 2 信息流 | ~4 文件（路由/组件/类型/首页接入） | 聚合查询性能 | 索引 + 归并排序 + 前端懒加载详情 |
| 3 短评+徽章 | ~8 文件 | 范围膨胀 | 独立合入，权限评审 |

## 8. 决策点与推荐默认值

> 状态：标注「✅ 已确认」的为评审确认后的定稿；其余待确认。

1. **`VOTE` 是否加入 `defaultPermissions` 默认权限模板？**
   - **推荐：加入。** `server/lib/settings/index.ts:396` 当前默认 `Permission.REQUEST`，建议改为 `Permission.REQUEST | Permission.VOTE`。理由：点赞是低风险表达性操作，与 `REQUEST` 同级；默认不含会导致新用户无点赞能力、功能形同虚设。
   - 补充：`PermissionEdit`（`src/components/PermissionEdit/index.tsx`）当前**未展示** VOTE 选项，需在权限编辑 UI 中新增「声援/点赞」条目（挂在独立分组或 `request` 分组下），否则管理员无法为存量用户授予该权限。
   - 存量用户：设置里已保存的 `defaultPermissions` 不会自动变更，仅新用户与重置默认时生效；存量用户由管理员在用户编辑页手动勾选（依赖上一条的 UI 新增）。

2. **是否允许给自己请求点赞？**
   - **推荐：不允许（400）。** 自赞无意义且易被当作「刷存在感」；请求人已通过「请求」本身表达意向。

3. **点赞用户头像列表的可见范围？**
   - **推荐：请求人本人 + `REQUEST_VIEW` 权限用户可见完整头像列表；其余登录用户仅见数量。** 平衡隐私与社交展示。✅ 已确认

4. **阶段 2 信息流采用「聚合查询」还是「新建 activity 表」？**
   - **推荐：先聚合查询，不落新表。** 当前数据量级（家庭/小团队）聚合查询足够，避免同步维护成本；如遇性能瓶颈再物化。✅ 已确认

5. **阶段 3 短评是否需要独立权限，还是复用 `REQUEST`？**
   - **推荐：复用 `REQUEST`，不新增权限位。** 短评与请求同属「表达意向」，权限位是稀缺的二进制位，能复用就复用。
