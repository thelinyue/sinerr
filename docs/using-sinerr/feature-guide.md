---
title: 功能使用指南
description: Sinerr 全功能使用操作文档（v1.7.x）
sidebar_position: 1
---

# 功能使用指南

本文档覆盖 Sinerr 当前版本（v1.7.x）的全部功能与操作方式，从登录、日常使用到管理配置与进阶能力（MCP / PWA / 局域网访问）。

## 1. 登录

Sinerr 支持两种登录方式（可在「设置 → 常规」中启用/关闭）：

- **本地账号**：设置页创建的用户，用用户名 + 密码登录。
- **媒体服务器账号**：使用 Jellyfin / Emby 账号直接登录（需配置媒体服务器并启用「允许媒体服务器登录」）。

首次部署会进入初始化向导，创建管理员账号并配置媒体服务器。

## 2. 权限与角色

权限基于**位标志**组合，管理员在「设置 → 用户」中为用户分配：

| 权限 | 说明 |
|---|---|
| 管理员 | 全部权限 |
| 管理用户 | 用户增删改、导入媒体服务器用户 |
| 管理请求 | 审批/驳回/删除请求 |
| 发起请求 | 可提交新请求 |
| 点赞声援 | 可给请求点赞 |
| 自动批准 | 请求自动通过 |
| 请求电影 / 请求剧集 | 细分可请求的类型 |
| 请求查看 | 查看请求列表与详情 |
| 管理问题 / 查看问题 / 发起问题 | 问题反馈能力 |
| 管理黑名单 / 查看黑名单 | 封禁内容管理 |

常见预设：
- **管理员**：全部权限
- **内容主管**：管理用户/请求/问题/黑名单，请求自动批准
- **普通用户**：发起请求 + 点赞 + 报问题（可按需细分电影/剧集）
- **受限用户**：仅浏览/点赞/报问题，无请求权限

## 3. 发现页

发现页是应用首页，自上而下：

- **顶部轮播（最近添加）**：最近入库的影视与剧集更新，16:7 横版背景；剧名后内联「第 N 季」/「全 N 季」，连载中显示「＋N 集」，已完结显示「已完结 · 全 N 季」。
- **内容滑块**：最新请求、趋势、热门电影/剧集、上映中、类型、片方等。管理员可点右上角画笔自定义滑块（增删、排序、启停）。

## 4. 动态 Tab（本周热播 + 活动流）

顶部「发现 / 动态」Tab 切换。

### 本周热播
按最近 7 天播放量聚合的周榜：

- **领奖台**：第 1 名居中、第 2 名居左、第 3 名居右，横版大图；底部金银铜**人气条**（条长 = 相对第 1 名的观看次数比例，颜色表名次）
- **分类**：全部 / 电影 / 剧集 过滤
- **完整榜单**：「查看完整榜单」弹出 Top20 明细，每行带相对人气背景填充
- 背景为 Top1-3 影片横版图**交叉渐变轮播**，hover 暂停、离屏停止

### 活动流
按时间线展示全站动作，可按类型过滤（请求 / 点赞 / 问题 / 播放 / 影评）并「只看我」：

- **请求**：某用户请求了某影片
- **点赞**：某用户声援了某请求
- **问题**：某用户报告了问题
- **播放**：某用户观看了某影片，显示**播放设备**（如「在 iPhone 上播放」）与时长
- **影评**：评分 + 短评内容

## 5. 搜索

顶部搜索框输入关键词实时搜索电影/剧集，回车或点击结果进入详情。搜索支持模糊匹配媒体服务器 / TMDB 内容。

## 6. 请求管理

- **发起请求**：详情页点击「请求」；剧集可选指定季或全部季
- **状态流转**：待审 → 批准 / 拒绝 / 失败；媒体入库后自动完成
- **点赞声援**：有权限的用户可点赞，点赞数显示在请求上
- **配额**：管理员可为用户设置电影/剧集的**请求上限（数量 / 周期天数）**，超限拦截
- **审批**：具备「管理请求」权限的用户在请求卡上批准 / 驳回

## 7. 问题反馈

- 详情页「报告问题」，类型：视频 / 音频 / 其他
- 支持**评论**跟进，管理员可标记解决
- 问题动态出现在活动流

## 8. 影评

详情页可发表评分 + 一句话短评；影评展示在详情页与活动流中。

## 9. 播放记录

播放数据来自 **Emby / Jellyfin Webhook**（`playback.start` / `playback.stop`）：

- 动态页显示「观看了 xxx」+ 播放设备 + 时长（净播放）
- 用户详情可查看播放统计（次数 / 时长，来自 Playback Reporting 插件聚合）
- 隐私：用户可关闭「播放记录可见」，管理员始终可见

## 9.1 Emby / Jellyfin Webhook 配置

在 Emby/Jellyfin 的 **Webhook 插件**中，向 Sinerr 推送以下事件：

- **端点**：`POST /api/v1/webhook/emby?api_key=<应用密钥>`
- **鉴权**：`api_key` 参数 = 「设置 → 常规 → 应用密钥」
- **需订阅事件**：`playback.start` / `playback.stop`（播放记录）；`library.new` / `item.updated`（媒体库刷新）

### 载荷格式（两种兼容）

**Jellyfin Webhook 插件（扁平字段）**：
```json
{
  "Event": "playback.stop",
  "UserId": "媒体服务器用户ID",
  "Provider_tmdb": "5545",
  "ProviderIds": { "Tmdb": "5545" },
  "ItemType": "Movie",
  "SeasonNumber": 1,
  "EpisodeNumber": 3,
  "PlayedToCompletion": true,
  "DeviceName": "iPhone"
}
```

**Emby 官方 Webhooks（嵌套对象）**：
```json
{
  "Event": "playback.stop",
  "User": { "Id": "媒体服务器用户ID" },
  "Item": {
    "Id": "媒体项ID",
    "Type": "Episode",
    "IndexNumber": 3,
    "ParentIndexNumber": 1,
    "ProviderIds": { "Tmdb": "5545" }
  },
  "PlaybackInfo": {
    "PositionTicks": 2500000000,
    "MediaSource": { "RunTimeTicks": 2700000000 }
  },
  "Device": { "Name": "Chrome (Windows)" },
  "Session": { "DeviceName": "Apple TV" }
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `Event` | 事件名，仅处理 `playback.start` / `playback.stop` |
| `UserId` / `User.Id` | 媒体服务器用户 ID（用于关联 Sinerr 用户） |
| `Provider_tmdb` / `ProviderIds.Tmdb` | TMDB ID（取不到时用 `Item.Id` 反查媒体服务器） |
| `ItemType` / `Item.Type` | `Movie` / `Episode`（决定电影还是剧集） |
| `PlaybackInfo.PositionTicks` | 播放位置（1 秒 = 10,000,000 ticks），计算净时长 |
| `PlayedToCompletion` | 是否看完（决定 `completed`） |
| 设备名 | 优先级：`DeviceName` → `Device.Name`/`Device`（字符串）→ `Session.DeviceName`；取不到则动态不显示设备 |

## 10. 用户管理

「设置 → 用户」：

- **本地用户**：新建/编辑，设置用户名、昵称、密码、权限、配额、头像
- **导入媒体服务器用户**：从 Jellyfin / Emby 拉取用户批量创建
- **头像**：支持上传图片；无头像的用户自动显示**渐变首字**（有昵称取昵称首字，否则用户名首字）

## 11. 设置

- **常规**：站点标题、应用 URL、缓存图片、本地登录开关、默认权限/配额
- **媒体服务器**：Jellyfin / Emby 连接（主机、API Key）
- **MoviePilot**：订阅状态集成（订阅中 / 已完成 / 暂停徽标）
- **通知**：Discord / 邮件 / Telegram / Pushover / WebPush / Webhook 等
- **网络**：HTTP(S) 代理（供 TMDB 等外网请求使用）、DNS 缓存
- **黑名单**：按标签封禁内容

## 12. MCP（AI 工具集成）

Sinerr 提供 **MCP（Model Context Protocol）** 端点，供 AI 助手调用：

- **端点**：`GET/POST /api/v1/mcp`
- **鉴权**：Bearer 令牌 = 「应用程序密钥」（设置 → 常规 → 应用密钥），需开启「启用 MCP」
- **工具**：

| 工具 | 说明 |
|---|---|
| `search_media` | 关键词搜索影视 |
| `list_requests` | 列出请求（可按状态过滤） |
| `get_request` | 查询单个请求详情 |
| `list_activity` | 读取最近动态 |
| `list_users` | 用户列表 |
| `get_user` | 查询单个用户 |
| `list_recently_added` | 最近添加 |
| `request_media` | 发起请求（写操作） |
| `update_request_status` | 审批/驳回/转待处理（写操作） |
| `delete_request` | 删除请求（写操作） |

示例（Claude / 自定义客户端配置）：
```json
{
  "mcpServers": {
    "sinerr": {
      "url": "https://你的域名/api/v1/mcp",
      "headers": { "Authorization": "Bearer 应用密钥" }
    }
  }
}
```

## 13. PWA（移动端安装）

Sinerr 是 PWA，可安装到手机/桌面：

- 浏览器地址栏出现「安装应用」时点击，或「添加到主屏幕」
- 安装后以**独立窗口**运行（`display-mode: standalone`），显示顶部 PWA 专属边框与返回按钮
- 已适配刘海屏安全区（`viewport-fit=cover` + safe-area padding）
- 离线时回退离线页；`sw.js` 版本号递增自动更新缓存

## 14. 局域网 / 远程访问

- 局域网：访问宿主机 IP 即可，如 `http://192.168.11.100:5055`
- 端口转发 / 反向代理（如 Nginx/Caddy）可对外发布，建议配 HTTPS（`applicationUrl` 指向公网地址）

## 14.1 Docker 环境变量

下表为 Docker 部署支持的全部环境变量（均在 `docker run -e` 或 `compose.yaml` 的 `environment` 中设置）。

### 数据库

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_TYPE` | `sqlite` | 设为 `postgres` 使用 PostgreSQL，否则 SQLite |
| `DB_HOST` | — | PostgreSQL 主机（`DB_TYPE=postgres` 时必填） |
| `DB_PORT` | `5432` | PostgreSQL 端口 |
| `DB_USER` / `DB_PASS` | — | PostgreSQL 用户名 / 密码 |
| `DB_NAME` | `sinerr` | PostgreSQL 数据库名 |
| `DB_SOCKET_PATH` | — | 用 Unix Socket 连接（如 Cloud SQL），与 `DB_HOST` 二选一 |
| `DB_USE_SSL` | `false` | `true` 启用 PostgreSQL SSL |
| `DB_POOL_SIZE` | — | 连接池大小 |
| `DB_LOG_QUERIES` | `false` | `true` 输出 SQL 日志 |
| `CONFIG_DIRECTORY` | 容器内 `/app/config` | 配置目录（settings.json / 数据库 / 日志 / 图片缓存存储位置） |

### 网络与运行

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5055` | HTTP 监听端口 |
| `HOST` | 所有接口 | HTTP 监听地址 |
| `NODE_ENV` | — | `production` 运行生产构建；容器默认已设置，启动时自动执行数据库迁移 |
| `TZ` | — | 时区（如 `Asia/Shanghai`），影响日志与展示时间 |
| `LOG_LEVEL` | `debug` | 日志级别（debug / info / warn / error） |

### 第三方 API Key（覆盖内置默认）

| 变量 | 说明 |
|---|---|
| `TMDB_API_KEY` | 覆盖内置共享 TMDB key（建议自备） |
| `TVDB_API_KEY` | 覆盖内置 TVDB key |
| `ROTTEN_TOMATOES_ALGOLIA_API_KEY` | 覆盖烂番茄评分 key |
| `API_KEY` | 应用密钥（MCP Bearer / Webhook 鉴权用，覆盖设置页值） |
| `JELLYFIN_TYPE` | `emby` 表示媒体服务器为 Emby（用于设置迁移），默认 Jellyfin |

### 其他

| 变量 | 说明 |
|---|---|
| `GITHUB_TOKEN` | 仅设置页「关于」拉取 GitHub 信息用 |

### 示例（PostgreSQL）

```bash
docker run -d --name sinerr \
  -e DB_TYPE=postgres \
  -e DB_HOST=127.0.0.1 \
  -e DB_PORT=5432 \
  -e DB_USER=sinerr \
  -e DB_PASS=yourpass \
  -e DB_NAME=sinerr \
  -e TZ=Asia/Shanghai \
  -p 5055:5055 \
  -v sinerr-config:/app/config \
  thelinyue/sinerr:latest
```

## 15. 常见问题

- **更新弹窗「Sinerr 已更新」**：前端构建版本与后端不一致时出现，硬刷新即可；正式版由 CI 传入一致版本号
- **TMDB 图片/详情加载失败**：检查「设置 → 网络」代理是否正确
- **播放进度不显示**：确认已安装 Emby/Jellyfin 的 **Playback Reporting 插件**并开启 Webhook 推送
