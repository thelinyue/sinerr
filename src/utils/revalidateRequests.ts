import { mutate } from 'swr';

const REQUEST_KEY_PREFIX = '/api/v1/request';

export const revalidateRequests = () =>
  mutate((key: unknown) => {
    if (typeof key !== 'string') {
      return false;
    }

    return key.startsWith(REQUEST_KEY_PREFIX);
  });
