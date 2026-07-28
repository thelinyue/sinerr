---
title: Services
description: Configure your default services.
sidebar_position: 4
---

# Services

:::info
**If you need to integrate with external download management services, you can configure them here.**

Sinerr checks these linked services to determine whether or not media has already been requested or is available.
:::

### MoviePilot Settings

#### Default Server

At least one server needs to be marked as "Default" in order for requests to be sent successfully to MoviePilot.

#### Server Name

Enter a friendly name for the MoviePilot server.

#### Hostname or IP Address

If you have Sinerr installed on the same network as MoviePilot, you can set this to the local IP address of your MoviePilot server. Otherwise, this should be set to a valid hostname (e.g., `moviepilot.example.com`).

#### Port

This value should be set to the port that your MoviePilot server listens on. By default, MoviePilot uses port `3000`, but you may need to set this to `443` or some other value if your MoviePilot server is hosted on a VPS or cloud provider.

#### Use SSL

Enable this setting to connect to MoviePilot via HTTPS rather than HTTP. Self-signed certificates are not trusted by default, but you can configure Sinerr to accept them. See [Self-Signed Certificates](/using-sinerr/advanced/self-signed-certificates) for details.

#### API Key

Enter your MoviePilot API key here. Do _not_ share these keys publicly, as they can be used to gain administrator access to your MoviePilot server!

#### URL Base

If you have configured a URL base for your MoviePilot server, you _must_ enter it here in order for Sinerr to connect to those services!

#### External URL (optional)

If the hostname or IP address you configured above is not accessible outside your network, you can set a different URL here. This "external" URL is used to add clickable links to your MoviePilot server on media detail pages.

#### Enable Scan (optional)

Enable this setting if you would like to scan your MoviePilot server for existing media/request status. It is recommended that you enable this setting, so that users cannot submit requests for media which has already been requested or is already available.
