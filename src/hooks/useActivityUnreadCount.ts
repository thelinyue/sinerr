import { useCallback, useState } from 'react';
import useSWR from 'swr';

const LAST_SEEN_KEY = 'activity-last-seen';
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

const readLastSeen = (): string => {
  try {
    return (
      localStorage.getItem(LAST_SEEN_KEY) ??
      new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString()
    );
  } catch {
    return new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString();
  }
};

interface ActivityUnread {
  count: number;
  markRead: () => void;
}

/**
 * 动态未读数（模块 1）
 *
 * 无状态固定窗口：since 取 localStorage activity-last-seen，轮询 /activity/count。
 * 侧栏「动态」入口与 Discover「动态」Tab 标签共用；进入动态流后 markRead 清空。
 */
export const useActivityUnreadCount = (): ActivityUnread => {
  const [, setVersion] = useState(0);
  const since = readLastSeen();

  // 不附加额外 query（避免 OpenApiValidator 拒绝未知参数）；markRead 后 since 变化即触发 re-fetch
  const { data, mutate } = useSWR<{ count: number }>(
    `/api/v1/activity/count?since=${encodeURIComponent(since)}`,
    { refreshInterval: 60000 }
  );

  const markRead = useCallback(() => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
    } catch {
      // localStorage may not be available
    }
    setVersion((v) => v + 1);
    mutate({ count: 0 }, false);
  }, [mutate]);

  return { count: data?.count ?? 0, markRead };
};
