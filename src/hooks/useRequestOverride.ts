interface OverrideStatus {
  server?: string;
  profile?: string;
  rootFolder?: string;
  languageProfile?: string;
}

const useRequestOverride = (): OverrideStatus => {
  return {};
};

export default useRequestOverride;
