import CachedImage from '@app/components/Common/CachedImage';
import { useEffect, useMemo, useState } from 'react';

interface UserAvatarProps {
  /** 用户信息；无头像（默认剪影）时回退渐变首字母 */
  user?: {
    avatar?: string | null;
    displayName?: string | null;
    username?: string | null;
    nickname?: string | null;
  } | null;
  /** 尺寸：sm=24 / md=40 / lg=64 / xl=80 / xxl=96 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  className?: string;
}

const DEFAULT_AVATAR = '/avatarproxy/default';

/** 渐变首字母配色板（按用户名哈希取色，同用户全局一致） */
const PALETTE: [string, string][] = [
  ['#6366f1', '#9333ea'],
  ['#0d9488', '#2563eb'],
  ['#d97706', '#dc2626'],
  ['#7c3aed', '#db2777'],
  ['#0284c7', '#22d3ee'],
  ['#65a30d', '#84cc16'],
  ['#b45309', '#f59e0b'],
  ['#be185d', '#f472b6'],
  ['#4338ca', '#818cf8'],
  ['#059669', '#34d399'],
  ['#ea580c', '#fb923c'],
  ['#0f766e', '#2dd4bf'],
];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
};

const SIZES: Record<string, { box: string; font: string; px: number }> = {
  sm: { box: 'h-6 w-6 text-[10px]', font: 'text-[10px]', px: 24 },
  md: { box: 'h-10 w-10 text-base', font: 'text-base', px: 40 },
  lg: { box: 'h-16 w-16 text-2xl', font: 'text-2xl', px: 64 },
  xl: { box: 'h-20 w-20 text-3xl', font: 'text-3xl', px: 80 },
  xxl: { box: 'h-24 w-24 text-4xl', font: 'text-4xl', px: 96 },
};

/**
 * 用户头像（Sinerr 2.0）
 *
 * 有真实头像（上传 / 媒体服务器）→ 显示图片，加载失败回退渐变字；
 * 无头像（默认剪影）→ 渐变首字母：有昵称取昵称首字，否则用户名首字母。
 */
const UserAvatar = ({ user, size = 'md', className = '' }: UserAvatarProps) => {
  const [imgError, setImgError] = useState(false);

  // 用户身份变化时重置图片错误态，避免复用实例时残留回退
  useEffect(() => {
    setImgError(false);
  }, [user?.avatar]);

  const letter = useMemo(() => {
    const raw =
      user?.nickname?.trim() ||
      user?.username?.trim() ||
      user?.displayName?.trim() ||
      '?';
    return raw.slice(0, 1).toUpperCase();
  }, [user?.nickname, user?.username, user?.displayName]);

  const gradient = useMemo(() => {
    const key = user?.username || user?.displayName || '?';
    const [c1, c2] = PALETTE[hash(key) % PALETTE.length];
    return `linear-gradient(135deg, ${c1}, ${c2})`;
  }, [user?.username, user?.displayName]);

  const hasRealAvatar =
    !!user?.avatar && user.avatar !== DEFAULT_AVATAR && !imgError;
  const sizeCfg = SIZES[size] ?? SIZES.md;

  if (hasRealAvatar) {
    return (
      <CachedImage
        type="avatar"
        src={user!.avatar!}
        alt={user?.displayName ?? ''}
        className={`${sizeCfg.box} flex-shrink-0 rounded-full object-cover ${className}`}
        width={sizeCfg.px}
        height={sizeCfg.px}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeCfg.box} flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{ background: gradient }}
      aria-label={user?.displayName ?? ''}
    >
      <span className={sizeCfg.font}>{letter}</span>
    </div>
  );
};

export default UserAvatar;
