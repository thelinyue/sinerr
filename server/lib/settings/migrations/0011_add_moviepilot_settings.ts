import type { AllSettings } from '@server/lib/settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addMoviePilotSettings = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0011_add_moviepilot_settings')
  ) {
    return settings;
  }

  if (!settings.moviepilot) {
    settings.moviepilot = [];
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0011_add_moviepilot_settings');

  return settings;
};

export default addMoviePilotSettings;
