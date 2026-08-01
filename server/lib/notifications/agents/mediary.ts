import MediaryAPI from '@server/api/mediary';
import type { NotificationAgentMediary } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import { Notification, hasNotificationType } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent } from './agent';

class MediaryAgent
  extends BaseAgent<NotificationAgentMediary>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentMediary {
    if (this.settings) {
      return this.settings;
    }

    const settings = getSettings();

    return settings.notifications.agents.mediary;
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (settings.enabled) {
      return true;
    }

    return false;
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    const settings = this.getSettings();

    if (
      !payload.notifySystem ||
      !hasNotificationType(type, settings.types ?? 0)
    ) {
      return true;
    }

    const appSettings = getSettings();
    if (appSettings.mediary.length === 0) {
      return true;
    }

    const defaultMediary = appSettings.mediary.find((m) => m.isDefault);
    if (!defaultMediary) {
      return true;
    }

    logger.debug('Sending Mediary notification', {
      label: 'Notifications',
      type: Notification[type],
      subject: payload.subject,
    });

    try {
      await axios.post(
        `${MediaryAPI.buildUrl(defaultMediary)}/api/notifications`,
        {
          type: Notification[type],
          event: payload.event,
          subject: payload.subject,
          message: payload.message,
          image: payload.image,
          media: payload.media
            ? {
                tmdbId: payload.media.tmdbId,
                tvdbId: payload.media.tvdbId,
                imdbId: payload.media.imdbId,
                mediaType: payload.media.mediaType,
                status: payload.media.status,
              }
            : undefined,
          request: payload.request
            ? {
                id: payload.request.id,
                requestedBy: payload.request.requestedBy?.displayName,
              }
            : undefined,
          extra: payload.extra,
        },
        {
          headers: {
            Authorization: `Bearer ${defaultMediary.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return true;
    } catch (e) {
      logger.warn('Error sending Mediary notification', {
        label: 'Notifications',
        type: Notification[type],
        subject: payload.subject,
        errorMessage: e.message,
        response: e?.response?.data,
      });

      return false;
    }
  }
}

export default MediaryAgent;
