import { MediaServerType } from '@server/constants/server';
import blocklistedTagsProcessor from '@server/job/blocklistedTagsProcessor';
import { refreshMostPlayedCache } from '@server/job/refreshMostPlayedCache';
import availabilitySync from '@server/lib/availabilitySync';
import ImageProxy from '@server/lib/imageproxy';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import type { JobId } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import schedule from 'node-schedule';

interface ScheduledJob {
  id: JobId;
  job: schedule.Job;
  name: string;
  type: 'process' | 'command';
  interval: 'seconds' | 'minutes' | 'hours' | 'days' | 'fixed';
  cronSchedule: string;
  running?: () => boolean;
  cancelFn?: () => void;
}

export const scheduledJobs: ScheduledJob[] = [];

export const startJobs = (): void => {
  const jobs = getSettings().jobs;
  const mediaServerType = getSettings().main.mediaServerType;

  if (
    mediaServerType === MediaServerType.JELLYFIN ||
    mediaServerType === MediaServerType.EMBY
  ) {
    // Run recently added jellyfin sync every 5 minutes
    scheduledJobs.push({
      id: 'jellyfin-recently-added-scan',
      name: 'Jellyfin Recently Added Scan',
      type: 'process',
      interval: 'minutes',
      cronSchedule: jobs['jellyfin-recently-added-scan'].schedule,
      job: schedule.scheduleJob(
        jobs['jellyfin-recently-added-scan'].schedule,
        async () => {
          const autoScan = getSettings().jellyfin.autoScan ?? true;
          if (!autoScan) return;
          if (jellyfinRecentScanner.status().running) {
            logger.info('Skipping Jellyfin Recently Added Scan: already running', {
              label: 'Jobs',
            });
            return;
          }
          logger.info('Starting scheduled job: Jellyfin Recently Added Scan', {
            label: 'Jobs',
          });
          try {
            await jellyfinRecentScanner.run();
          } catch (e) {
            logger.error('Error during Jellyfin Recently Added Scan', {
              label: 'Jobs',
              message: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        }
      ),
      running: () => jellyfinRecentScanner.status().running,
      cancelFn: () => jellyfinRecentScanner.cancel(),
    });

    // Run full jellyfin sync every 24 hours
    scheduledJobs.push({
      id: 'jellyfin-full-scan',
      name: 'Jellyfin Full Library Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['jellyfin-full-scan'].schedule,
      job: schedule.scheduleJob(jobs['jellyfin-full-scan'].schedule, async () => {
        const autoScan = getSettings().jellyfin.autoScan ?? true;
        if (!autoScan) return;
        if (jellyfinFullScanner.status().running) {
          logger.info('Skipping Jellyfin Full Scan: already running', {
            label: 'Jobs',
          });
          return;
        }
        logger.info('Starting scheduled job: Jellyfin Full Scan', {
          label: 'Jobs',
        });
        try {
          await jellyfinFullScanner.run();
        } catch (e) {
          logger.error('Error during Jellyfin Full Scan', {
            label: 'Jobs',
            message: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }),
      running: () => jellyfinFullScanner.status().running,
      cancelFn: () => jellyfinFullScanner.cancel(),
    });

    // Refresh most played cache daily
    scheduledJobs.push({
      id: 'mostplayed-cache-refresh',
      name: 'Most Played Cache Refresh',
      type: 'process',
      interval: 'hours',
      cronSchedule: jobs['mostplayed-cache-refresh'].schedule,
      job: schedule.scheduleJob(
        jobs['mostplayed-cache-refresh'].schedule,
        async () => {
          const autoScan = getSettings().jellyfin.autoScan ?? true;
          if (!autoScan) return;
          logger.info('Starting scheduled job: Most Played Cache Refresh', {
            label: 'Jobs',
          });
          try {
            await refreshMostPlayedCache();
          } catch (e) {
            logger.error('Error during Most Played Cache Refresh', {
              label: 'Jobs',
              message: e instanceof Error ? e.message : 'Unknown error',
            });
          }
        }
      ),
    });
  }

  // Checks if media is still available in jellyfin libs
  scheduledJobs.push({
    id: 'availability-sync',
    name: 'Media Availability Sync',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['availability-sync'].schedule,
    job: schedule.scheduleJob(jobs['availability-sync'].schedule, async () => {
      if (availabilitySync.running) {
        logger.info('Skipping Media Availability Sync: already running', {
          label: 'Jobs',
        });
        return;
      }
      logger.info('Starting scheduled job: Media Availability Sync', {
        label: 'Jobs',
      });
      try {
        await availabilitySync.run();
      } catch (e) {
        logger.error('Error during Media Availability Sync', {
          label: 'Jobs',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }),
    running: () => availabilitySync.running,
    cancelFn: () => availabilitySync.cancel(),
  });

  // Run image cache cleanup every 24 hours
  scheduledJobs.push({
    id: 'image-cache-cleanup',
    name: 'Image Cache Cleanup',
    type: 'process',
    interval: 'hours',
    cronSchedule: jobs['image-cache-cleanup'].schedule,
    job: schedule.scheduleJob(jobs['image-cache-cleanup'].schedule, async () => {
      logger.info('Starting scheduled job: Image Cache Cleanup', {
        label: 'Jobs',
      });
      try {
        await ImageProxy.clearCache('tmdb');
        await ImageProxy.clearCache('avatar');
      } catch (e) {
        logger.error('Error during Image Cache Cleanup', {
          label: 'Jobs',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }),
  });

  scheduledJobs.push({
    id: 'process-blocklisted-tags',
    name: 'Process Blocklisted Tags',
    type: 'process',
    interval: 'days',
    cronSchedule: jobs['process-blocklisted-tags'].schedule,
    job: schedule.scheduleJob(jobs['process-blocklisted-tags'].schedule, async () => {
      if (blocklistedTagsProcessor.status().running) {
        logger.info('Skipping Process Blocklisted Tags: already running', {
          label: 'Jobs',
        });
        return;
      }
      logger.info('Starting scheduled job: Process Blocklisted Tags', {
        label: 'Jobs',
      });
      try {
        await blocklistedTagsProcessor.run();
      } catch (e) {
        logger.error('Error during Process Blocklisted Tags', {
          label: 'Jobs',
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }),
    running: () => blocklistedTagsProcessor.status().running,
    cancelFn: () => blocklistedTagsProcessor.cancel(),
  });

  logger.info('Scheduled jobs loaded', { label: 'Jobs' });
};
