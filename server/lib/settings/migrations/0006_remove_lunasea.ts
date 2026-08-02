import type { AllSettings } from '@server/lib/settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const removeLunaSeaSetting = (settings: any): AllSettings => {
  if (
    settings.notifications &&
    settings.notifications.agents &&
    settings.notifications.agents.lunasea
  ) {
    delete settings.notifications.agents.lunasea;
  }
  return settings;
};

export default removeLunaSeaSetting;
