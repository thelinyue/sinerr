import { Router } from 'express';

const router = Router();

const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#4b5563"/><circle cx="100" cy="82" r="38" fill="#d1d5db"/><path d="M42 176c4-42 32-60 58-60s54 18 58 60" fill="#d1d5db"/></svg>`;

export const DEFAULT_AVATAR_URL = '/avatarproxy/default';

router.get('/:jellyfinUserId', (_req, res) => {
  res
    .status(200)
    .set('Content-Type', 'image/svg+xml')
    .set('Cache-Control', 'public, max-age=3600')
    .send(DEFAULT_AVATAR_SVG);
});

export default router;
