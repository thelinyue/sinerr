import { getSettings } from '@server/lib/settings';
import { appDataPath } from '@server/utils/appDataVolume';
import { getHostname } from '@server/utils/getHostname';
import axios from 'axios';
import type { Response } from 'express';
import { Router } from 'express';
import { promises as fs } from 'fs';
import { join } from 'path';

const router = Router();

const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#4b5563"/><circle cx="100" cy="82" r="38" fill="#d1d5db"/><path d="M42 176c4-42 32-60 58-60s54 18 58 60" fill="#d1d5db"/></svg>`;

export const DEFAULT_AVATAR_URL = '/avatarproxy/default';

const sendDefaultAvatar = (res: Response) => {
  res
    .status(200)
    .set('Content-Type', 'image/svg+xml')
    .set('Cache-Control', 'public, max-age=3600')
    .send(DEFAULT_AVATAR_SVG);
};

router.get('/default', (_req, res) => {
  sendDefaultAvatar(res);
});

/** 读取本地上传的头像文件（`avatars/<userId>.<ext>`），找不到回退默认 */
async function serveUploadedAvatar(
  userId: string,
  res: Response
): Promise<void> {
  try {
    const dir = join(appDataPath(), 'avatars');
    const files = await fs.readdir(dir);
    const match = files.find((f) => f.startsWith(`${userId}.`));
    if (match) {
      const ext = match.split('.').pop()?.toLowerCase();
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'jpg' || ext === 'jpeg'
              ? 'image/jpeg'
              : 'application/octet-stream';
      const buffer = await fs.readFile(join(dir, match));
      res
        .status(200)
        .set('Content-Type', mime)
        .set('Cache-Control', 'public, max-age=3600')
        .send(buffer);
      return;
    }
  } catch {
    // 目录不存在或读取失败 → 回退默认
  }
  sendDefaultAvatar(res);
}

router.get('/upload/:userId', (req, res) => {
  void serveUploadedAvatar(req.params.userId, res);
});

/**
 * 代理 Jellyfin/Emby 用户真实头像（Sinerr 2.0 模块 7）
 *
 * 本地无上传头像时，转发 `${host}/Users/{jellyfinUserId}/Images/Primary`；
 * 失败/404 回退默认剪影。带 apiKey 鉴权。
 */
router.get('/:jellyfinUserId', async (req, res) => {
  const settings = getSettings();
  const hostname = getHostname();
  const apiKey = settings.jellyfin.apiKey;

  if (!apiKey || !hostname) {
    return res.status(404).send('No avatar');
  }

  try {
    const response = await axios.get(
      `${hostname}/Users/${req.params.jellyfinUserId}/Images/Primary`,
      {
        headers: { 'X-Emby-Token': apiKey },
        responseType: 'arraybuffer',
        timeout: 8000,
      }
    );
    const contentType =
      (response.headers['content-type'] as string) || 'image/png';
    res
      .status(200)
      .set('Content-Type', contentType)
      .set('Cache-Control', 'public, max-age=3600')
      .send(Buffer.from(response.data));
  } catch {
    // 媒体服务器无该用户真实头像（或不可达）→ 404，
    // 前端 UserAvatar 的 onError 自动回退渐变首字（有昵称取昵称首字，否则用户名首字）
    return res.status(404).send('No avatar');
  }
});

export default router;
