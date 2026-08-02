import { debounce } from 'lodash';
import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const IS_SCROLLING_CHECK_THROTTLE = 200;
const BUFFER_HEIGHT = 200;

/**
 * useVerticalScroll is a custom hook to handle infinite scrolling
 *
 * @param callback Callback is executed when page reaches bottom
 * @param shouldFetch Disables callback if true
 */
const useVerticalScroll = (
  callback: () => void,
  shouldFetch: boolean
): boolean => {
  const [isScrolling, setScrolling] = useState(false);

  type SetTimeoutReturnType = ReturnType<typeof setTimeout>;
  const scrollingTimer: MutableRefObject<SetTimeoutReturnType | undefined> =
    useRef(undefined);

  // Keep the latest callback/shouldFetch in refs so the scroll listeners only
  // need to be registered once instead of re-subscribing on every render.
  const callbackRef = useRef(callback);
  const shouldFetchRef = useRef(shouldFetch);
  callbackRef.current = callback;
  shouldFetchRef.current = shouldFetch;

  const runCallback = useCallback(() => {
    if (shouldFetchRef.current) {
      const scrollTop = Math.max(
        window.pageYOffset,
        document.documentElement.scrollTop,
        document.body.scrollTop
      );
      if (
        window.innerHeight + scrollTop >=
        document.documentElement.offsetHeight - BUFFER_HEIGHT
      ) {
        callbackRef.current();
      }
    }
  }, []);

  const debouncedCallback = useMemo(
    () => debounce(runCallback, 50),
    [runCallback]
  );

  // Re-check on every render so short pages auto-fill until they reach
  // the scroll threshold.
  useEffect(() => {
    runCallback();
  });

  useEffect(() => {
    const onScroll = () => {
      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }
      setScrolling(true);

      scrollingTimer.current = setTimeout(() => {
        setScrolling(false);
      }, IS_SCROLLING_CHECK_THROTTLE);
      debouncedCallback();
    };

    const onResize = () => {
      debouncedCallback();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      debouncedCallback.cancel();

      if (scrollingTimer.current !== undefined) {
        clearTimeout(scrollingTimer.current);
      }
    };
  }, [debouncedCallback]);

  return isScrolling;
};

export default useVerticalScroll;
