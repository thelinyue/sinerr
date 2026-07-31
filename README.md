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
    image: ghcr.io/thelinyue/sinerr:dev
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
    image: ghcr.io/thelinyue/sinerr:dev
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
      - postgres:/var/lib/postgresql

volumes:
  postgres:
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

## API 文档

本地启动后访问 `http://localhost:5055/api-docs` 查看 API 文档。

## 参与贡献

欢迎参与 Sinerr 的开发！请参阅 [贡献指南](./CONTRIBUTING.md)。
