import type { AllSettings } from '@server/lib/settings';

const addMoviePilotSettings = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0009_add_moviepilot_settings')
  ) {
    return settings;
  }

  if (!settings.moviepilot) {
    settings.moviepilot = [];
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0009_add_moviepilot_settings');

  return settings;
};

export default addMoviePilotSettings;
