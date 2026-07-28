import type { MediaRequest } from '@server/entity/MediaRequest';

interface OverrideStatus {
  server?: string;
  profile?: string;
  rootFolder?: string;
  languageProfile?: string;
}

const useRequestOverride = (_request: MediaRequest): OverrideStatus => {
  return {};
};

export default useRequestOverride;
