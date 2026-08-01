<p align="center">
<img src="./public/logo_full.svg" alt="Sinerr" style="margin: 20px 0;">
</p>
<p align="center">
<img src="https://github.com/thelinyue/sinerr/actions/workflows/release.yml/badge.svg" alt="Sinerr Release" />
<img src="https://github.com/thelinyue/sinerr/actions/workflows/ci.yml/badge.svg" alt="Sinerr CI">
<img src="https://github.com/thelinyue/sinerr/actions/workflows/dev.yml/badge.svg" alt="Dev Build">
</p>
<p align="center">
<a href="https://github.com/thelinyue/sinerr/blob/develop/LICENSE"><img alt="GitHub" src="https://img.shields.io/github/license/thelinyue/sinerr"></a>
</p>

**Sinerr** 是一款免费开源的个人媒体库请求管理应用。支持对接 [Jellyfin](https://jellyfin.org)、[Emby](https://emby.media/) 媒体服务器，以及 [MoviePilot](https://github.com/jxxghp/MoviePilot) 等下载管理工具。

## Docker Compose 部署

```yaml
services:
  sinerr:
    image: ghcr.io/thelinyue/sinerr:latest
    container_name: sinerr
    restart: unless-stopped
    ports:
      - "5055:5055"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./config:/app/config
```

启动：

```bash
docker compose up -d
```

访问 `http://localhost:5055` 完成初始化配置。

### 使用 PostgreSQL 数据库

默认使用 SQLite。如需改用 PostgreSQL，请将 `DB_TYPE` 设为 `postgres` 并添加以下配置：

```yaml
services:
  sinerr:
    image: ghcr.io/thelinyue/sinerr:latest
    container_name: sinerr
    restart: unless-stopped
    ports:
      - "5055:5055"
    environment:
      - TZ=Asia/Shanghai
      - DB_TYPE=postgres
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USER=sinerr
      - DB_PASS=sinerr
      - DB_NAME=sinerr
      - DB_LOG_QUERIES=false
      - DB_USE_SSL=false
      - DB_POOL_SIZE=10
    volumes:
      - ./config:/app/config
    depends_on:
      - postgres
    links:
      - postgres

  postgres:
    image: postgres:18
    container_name: sinerr-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=sinerr
      - POSTGRES_PASSWORD=sinerr
      - POSTGRES_DB=sinerr
    volumes:
      - ./PostgreSQL:/var/lib/postgresql
```

启动：

```bash
docker compose up -d
```

访问 `http://localhost:5055` 完成初始化配置。

## 功能特性

- 完整的 Jellyfin/Emby 集成，支持用户导入与管理
- 支持 **PostgreSQL** 和 **SQLite** 数据库
- 支持电影、电视剧及混合媒体库
- 可为 SMTP 邮件通知修改邮箱地址
- 轻松对接 MoviePilot 等现有服务
- Jellyfin/Emby 媒体库扫描，自动追踪已有内容
- 可定制的请求系统，支持按季/按电影提交请求
- 简洁的请求管理界面
- 细粒度的权限系统
- 支持多种通知方式
- 移动端友好的响应式设计
- 支持关注列表与屏蔽列表

## Webhook 端点

Sinerr 提供内置 Webhook 端点，用于接收 Jellyfin/Emby 媒体服务器的事件通知，在媒体库内容变化时自动触发**增量扫描**，无需轮询即可同步新内容。

### 端点地址

```
POST http://<服务器地址>:5055/api/v1/webhook/emby
```

### 认证

若你在 Sinerr「设置 → 主界面」中配置了主 API 密钥，则调用时需通过查询参数传入相同的密钥，否则返回 `401 Unauthorized`：

```
POST /api/v1/webhook/emby?api_key=<主 API 密钥>
```

未配置主 API 密钥时，此端点可无需认证直接调用。

### 请求体

请求体为 JSON，包含 Jellyfin/Emby Webhook 事件字段（均为可选，仅 `Event` 用于判断是否触发扫描）：

| 字段       | 类型   | 说明                         |
| ---------- | ------ | ---------------------------- |
| `Event`    | string | 事件名称，如 `library.new`   |
| `ItemType` | string | 条目类型，如 `Movie`/`Series` |
| `Name`     | string | 条目名称                     |

### 触发扫描的事件

以下事件会触发 Sinerr 的增量扫描（`recent` 扫描，仅处理近期更新的条目）：

| 事件                         | 说明               |
| ---------------------------- | ------------------ |
| `library.new`                | 媒体库新增内容     |
| `system.libraryscancomplete` | 媒体库扫描完成     |
| `item.updated`               | 条目更新           |

其他事件仅记录日志，不触发扫描。处理完成后返回 `204 No Content`。

### 示例

```bash
curl -X POST "http://localhost:5055/api/v1/webhook/emby?api_key=<主 API 密钥>" \
  -H "Content-Type: application/json" \
  -d '{"Event": "library.new", "ItemType": "Movie", "Name": "示例影片"}'
```

### 在 Jellyfin/Emby 中配置

在媒体服务器的 Webhook 插件或通知配置中，将地址设置为上述端点，并勾选「媒体库新增」（Library new）、「库扫描完成」等事件即可。Sinerr 收到事件后会自动执行增量扫描。

## API 文档

本地启动后访问 `http://localhost:5055/api-docs` 查看 API 文档。

## 参与贡献

欢迎参与 Sinerr 的开发！请参阅 [贡献指南](./CONTRIBUTING.md)。
