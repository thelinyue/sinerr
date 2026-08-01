import { jellyfinRecentScanner } from '@server/lib/scanners/jellyfin';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const webhookRoutes = Router();

webhookRoutes.post('/emby', (req, res) => {
  const configuredApiKey = getSettings().main.apiKey;
  const providedApiKey = req.query.api_key as string | undefined;

  if (configuredApiKey && providedApiKey !== configuredApiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const event = req.body?.Event;
  const itemType = req.body?.ItemType;
  const itemName = req.body?.Name;

  logger.info('Received Jellyfin webhook', {
    label: 'Webhook',
    event,
    itemType,
    itemName,
  });

  if (
    event === 'library.new' ||
    event === 'system.libraryscancomplete' ||
    event === 'item.updated'
  ) {
    logger.info('Triggering recent scan due to Jellyfin webhook', {
      label: 'Webhook',
      event,
      itemName,
    });
    jellyfinRecentScanner.run();
  }

  res.status(204).send();
});

export default webhookRoutes;
