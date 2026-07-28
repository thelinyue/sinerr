<p align="center">
<img src="./public/logo_full.svg" alt="Sinerr" style="margin: 20px 0;">
</p>
<p align="center">
<img src="https://github.com/Linyue-GitHub/sinerr/actions/workflows/release.yml/badge.svg" alt="Sinerr Release" />
<img src="https://github.com/Linyue-GitHub/sinerr/actions/workflows/ci.yml/badge.svg" alt="Sinerr CI">
<img src="https://github.com/Linyue-GitHub/sinerr/actions/workflows/dev.yml/badge.svg" alt="Dev Build">
</p>
<p align="center">
<a href="https://github.com/Linyue-GitHub/sinerr/blob/develop/LICENSE"><img alt="GitHub" src="https://img.shields.io/github/license/Linyue-GitHub/sinerr"></a>
</p>

**Sinerr** is a free and open source software application for managing requests for your media library. It integrates with the media server of your choice: [Jellyfin](https://jellyfin.org) and [Emby](https://emby.media/). In addition, it integrates with your existing services, such as **[Sonarr](https://sonarr.tv/)** and **[Radarr](https://radarr.video/)**.

## Docker Compose 部署

```yaml
services:
  sinerr:
    image: ghcr.io/Linyue-GitHub/sinerr:dev
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

## Current Features

- Full Jellyfin/Emby integration including authentication with user import & management.
- Support for **PostgreSQL** and **SQLite** databases.
- Supports Movies, Shows and Mixed Libraries.
- Ability to change email addresses for SMTP purposes.
- Easy integration with your existing services. Currently, Sinerr supports Sonarr and Radarr. More to come!
- Jellyfin/Emby library scan, to keep track of the titles which are already available.
- Customizable request system, which allows users to request individual seasons or movies in a friendly, easy-to-use interface.
- Incredibly simple request management UI. Don't dig through the app to simply approve recent requests!
- Granular permission system.
- Support for various notification agents.
- Mobile-friendly design, for when you need to approve requests on the go!
- Support for watchlisting & blocklisting media.

## API Documentation

You can access the API documentation from your local Sinerr install at http://localhost:5055/api-docs

## Contributing

You can help improve Sinerr too! Check out our [Contribution Guide](./CONTRIBUTING.md) to get started.
