---
title: Web Push
description: Configure web push notifications for your users.
sidebar_position: 2
---

# Web Push

:::warning
Web push notifications require a secure connection to your Sinerr instance. Refer to the [Reverse Proxy](/extending-sinerr/reverse-proxy) documentation for more information.
:::

The web push notification agent enables you and your users to receive Sinerr notifications in a supported browser. This offers a native notification experience without the need to install an app.

This notification agent does not require any configuration, but is not enabled by default in Sinerr.

To set up web push notifications, simply enable the agent in **Settings â†?Notifications â†?Web Push**.

You and your users have the option to enable web push notifications by going to your **User Profile â†?Edit Settings â†?Notifications â†?Web Push â†?Enable web push**. Here you can also customize the notifications you'd like to receive.

:::info[Mobile Users]
For Web Push notifications to work on mobile you need to add Sinerr to your home screen as progressive web app (PWA). 
:::

:::info[iOS Users]
On iOS you may need to enable the Safari notifications feature flag by going to **Settings â†?Safari â†?Advanced â†?Feature Flags** and enabling "Notifications".
:::
