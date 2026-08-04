import Button from '@app/components/Common/Button';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.ConnectionGuide', {
  guideTitle: '三步开启观影',
  guideCopyAll: '复制全部信息',
  guideCopied: '已复制',
  guideStep1: '装好客户端',
  guideStep1Desc: '在手机 / 平板 / 电视上安装 {appName} 客户端',
  guideStep2: '连上服务器',
  guideStep2Desc: '类型选 {serverType}，地址填 {server}',
  guideStep3: '登录即看',
  guideStep3Desc: '账号 {username} + 密码',
  guideServerTypeEmby: 'Emby',
  guideServerTypeJellyfin: 'Jellyfin',
  guideNoServer: '尚未配置服务器',
  guideDismiss: '关闭',
});

interface ConnectionGuideProps {
  /** 嵌入模式（搜索页空态）：无页面级外边框 */
  embedded?: boolean;
}

/**
 * 「三步开启观影」引导卡片
 *
 * 方案 A：不再常驻探索页横幅，改为在搜索页空态（无查询 / 无结果）出现，
 * 用户在「想找片但可能还没播放器」的时刻看到引导。可手动关闭（localStorage）。
 */
const ConnectionGuide = ({ embedded = false }: ConnectionGuideProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { user } = useUser();
  const [dismissed, setDismissed] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setDismissed(
        localStorage.getItem('connection-guide-dismissed') === 'true'
      );
    } catch {
      setDismissed(true);
    }
  }, []);

  const serverUrl =
    settings.currentSettings.serverConnectionUrl ||
    settings.currentSettings.jellyfinExternalHost ||
    settings.currentSettings.jellyfinHost;
  const downloads = settings.currentSettings.clientDownloadUrls || [];

  // 无服务器信息（未配置媒体服务器）时引导无意义
  if (!serverUrl && downloads.length === 0) {
    return null;
  }

  if (dismissed) {
    return null;
  }

  const serverType =
    settings.currentSettings.mediaServerType === MediaServerType.EMBY
      ? intl.formatMessage(messages.guideServerTypeEmby)
      : settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? intl.formatMessage(messages.guideServerTypeJellyfin)
        : intl.formatMessage(messages.guideNoServer);

  // 登录账号用「用户名字段」，不用 displayName/昵称
  const loginUsername = user?.jellyfinUsername || user?.username || '';

  const dismiss = () => {
    try {
      localStorage.setItem('connection-guide-dismissed', 'true');
    } catch {
      // localStorage may not be available
    }
    setDismissed(true);
  };

  const copyAll = async () => {
    const lines = [
      `${intl.formatMessage(messages.guideStep2)}: ${serverUrl}`,
      `${intl.formatMessage(messages.guideStep3)}: ${loginUsername}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard permission denied
    }
  };

  return (
    <div
      className={`rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-600/25 to-purple-600/25 ${
        embedded ? 'p-4' : 'mb-6 overflow-hidden'
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">
          <span className="mr-1.5">🎬</span>
          {intl.formatMessage(messages.guideTitle)}
        </h2>
        <button
          onClick={dismiss}
          className="text-xs text-gray-400 transition hover:text-white"
          aria-label={intl.formatMessage(messages.guideDismiss)}
        >
          ✕
        </button>
      </div>
      <div className="mt-3 space-y-3 border-t border-indigo-500/20 pt-3">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            1
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">
              {intl.formatMessage(messages.guideStep1)}
            </p>
            <p className="text-xs text-gray-300">
              {downloads.length > 0
                ? intl.formatMessage(messages.guideStep1Desc, {
                    appName: settings.currentSettings.applicationTitle,
                  })
                : intl.formatMessage(messages.guideStep1Desc, {
                    appName: settings.currentSettings.applicationTitle,
                  })}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            2
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">
              {intl.formatMessage(messages.guideStep2)}
            </p>
            <p className="text-xs text-gray-300">
              {serverUrl ? (
                <>
                  <span className="font-semibold text-emerald-300">
                    {serverType}
                  </span>{' '}
                  ·{' '}
                  <code className="rounded bg-gray-800/80 px-1 font-mono">
                    {serverUrl}
                  </code>
                </>
              ) : (
                intl.formatMessage(messages.guideNoServer)
              )}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            3
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">
              {intl.formatMessage(messages.guideStep3)}
            </p>
            <p className="text-xs text-gray-300">
              {intl.formatMessage(messages.guideStep3Desc, {
                username: loginUsername || '…',
              })}
            </p>
          </div>
        </div>
        <Button buttonType="primary" buttonSize="sm" onClick={copyAll}>
          <span>
            {copied
              ? intl.formatMessage(messages.guideCopied)
              : intl.formatMessage(messages.guideCopyAll)}
          </span>
        </Button>
      </div>
    </div>
  );
};

export default ConnectionGuide;
