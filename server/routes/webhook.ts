import { jellyfinRecentScanner } from '@server/lib/scanners/jellyfin';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const webhookRoutes = Router();

webhookRoutes.post('/emby', async (req, res) => {
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
    if (jellyfinRecentScanner.status().running) {
      logger.info('Skipping recent scan: already running', {
        label: 'Webhook',
        event,
      });
    } else {
      logger.info('Triggering recent scan due to Jellyfin webhook', {
        label: 'Webhook',
        event,
        itemName,
      });
      try {
        await jellyfinRecentScanner.run();
      } catch (e) {
        logger.error('Error during Jellyfin webhook scan', {
          label: 'Webhook',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
  }

  res.status(204).send();
});

export default webhookRoutes;
