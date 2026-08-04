import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/**
 * /activity 已并入探索页「动态」Tab（/?tab=activity）。
 * 这里做客户端重定向并透传原有 type/userId 筛选参数，兼容旧书签/旧链接。
 */
const ActivityPage: NextPage = () => {
  const router = useRouter();

  useEffect(() => {
    const { type, userId } = router.query;
    const query: Record<string, string> = { tab: 'activity' };
    if (type) query.type = String(type);
    if (userId) query.userId = String(userId);

    router.replace({ pathname: '/', query });
  }, [router]);

  return null;
};

export default ActivityPage;
