import type { AllSettings } from '@server/lib/settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addMediarySettings = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0010_add_mediary_settings')
  ) {
    return settings;
  }

  if (!settings.mediary) {
    settings.mediary = [];
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0010_add_mediary_settings');

  return settings;
};

export default addMediarySettings;
