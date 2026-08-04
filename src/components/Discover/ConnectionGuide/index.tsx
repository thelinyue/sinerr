import Button from '@app/components/Common/Button';
import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaServerType } from '@server/constants/server';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.ConnectionGuide', {
  guideTitle: '观影指南',
  guideCopyAll: '复制全部信息',
  guideCopied: '已复制',
  guideStep1: '装好客户端',
  guideStep1Desc: '在手机 / 平板 / 电视上安装客户端',
  guideStep2: '连上服务器',
  guideStep2Desc: '类型选 {serverType}，地址填 {server}',
  guidePortHint: '（HTTPS 默认端口 443，可省略）',
  guideStep3: '登录即看',
  guideStep3Desc: '账号 {username} + 密码',
  guideServerTypeEmby: 'Emby',
  guideServerTypeJellyfin: 'Jellyfin',
  guideNoServer: '尚未配置服务器',
  guideNoDownload: '未配置客户端下载地址，请到 设置 → 常规 填写',
  guideDismiss: '关闭',
});

interface ConnectionGuideProps {
  /** 嵌入模式（搜索页空态）：无页面级外边框 */
  embedded?: boolean;
}

/**
 * 「观影指南」引导卡片
 *
 * 三步指引：装客户端（含下载地址）→ 连服务器（含 443 提示）→ 登录即看。
 * 集成在顶栏搜索框：聚焦搜索且未输入时以嵌入式卡片显示（embedded），
 * 开始输入即隐藏并进入搜索结果。
 */
const ConnectionGuide = ({ embedded = false }: ConnectionGuideProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const { user } = useUser();
  const [copied, setCopied] = useState(false);

  const serverUrl =
    settings.currentSettings.serverConnectionUrl ||
    settings.currentSettings.jellyfinExternalHost ||
    settings.currentSettings.jellyfinHost;
  const downloads = settings.currentSettings.clientDownloadUrls || [];

  // 无服务器信息/下载地址时仍展示指引，对应步骤显示「未配置」提示（引导新用户去设置）

  const serverType =
    settings.currentSettings.mediaServerType === MediaServerType.EMBY
      ? intl.formatMessage(messages.guideServerTypeEmby)
      : settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN
        ? intl.formatMessage(messages.guideServerTypeJellyfin)
        : intl.formatMessage(messages.guideNoServer);

  // 登录账号用「用户名字段」，不用 displayName/昵称
  const loginUsername = user?.jellyfinUsername || user?.username || '';

  const isHttps = serverUrl ? /^https:\/\//i.test(serverUrl) : false;

  const copyAll = async () => {
    const lines = [
      `${intl.formatMessage(messages.guideStep2)}: ${serverType} ${serverUrl}`,
      `${intl.formatMessage(messages.guideStep3)}: ${loginUsername}`,
      ...downloads.map((d) => `${d.name}: ${d.url}`),
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
            {downloads.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {downloads.map((d) => (
                  <a
                    key={d.name}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-black/40 px-2.5 py-1 text-xs text-indigo-200 transition hover:bg-black/60 hover:text-white"
                  >
                    <span className="text-[10px]">{d.icon}</span>
                    {d.name}
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-gray-300">
                {intl.formatMessage(messages.guideNoDownload)}
              </p>
            )}
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
            {serverUrl ? (
              <p className="mt-1 text-xs text-gray-300">
                <span className="font-semibold text-emerald-300">
                  {serverType}
                </span>{' '}
                ·{' '}
                <code className="rounded bg-gray-800/80 px-1 font-mono">
                  {serverUrl}
                </code>
                {isHttps && (
                  <span className="ml-1.5 text-gray-400">
                    {intl.formatMessage(messages.guidePortHint)}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-300">
                {intl.formatMessage(messages.guideNoServer)}
              </p>
            )}
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
            <p className="mt-1 text-xs text-gray-300">
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
