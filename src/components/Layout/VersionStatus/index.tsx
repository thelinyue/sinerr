import defineMessages from '@app/utils/defineMessages';
import {
  BeakerIcon,
  CodeBracketIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import type { StatusResponse } from '@server/interfaces/api/settingsInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Layout.VersionStatus', {
  streamdevelop: 'Sinerr Develop',
  streamstable: 'Sinerr Stable',
  seerrbased: 'Based on Seerr v{version}',
});

interface VersionStatusProps {
  onClick?: () => void;
}

const VersionStatus = ({ onClick }: VersionStatusProps) => {
  const intl = useIntl();
  const { data } = useSWR<StatusResponse>('/api/v1/status', {
    refreshInterval: 60 * 1000,
  });

  if (!data) {
    return null;
  }

  const isLocal = data.commitTag === 'local';
  const isDevelop = !isLocal && data.version.startsWith('develop-');

  const versionStream = isLocal
    ? 'Keep it up! 👍'
    : isDevelop
      ? intl.formatMessage(messages.streamdevelop)
      : intl.formatMessage(messages.streamstable);

  const accentClass = isLocal
    ? 'bg-sky-500/10 text-sky-400'
    : isDevelop
      ? 'bg-amber-500/10 text-amber-400'
      : 'bg-emerald-500/10 text-emerald-400';
  const dotClass = isLocal
    ? 'bg-sky-400'
    : isDevelop
      ? 'bg-amber-400'
      : 'bg-emerald-400';

  return (
    <Link
      href="/settings/about"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onClick) {
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      title={
        data.seerrVersion && data.seerrVersion !== 'unknown'
          ? intl.formatMessage(messages.seerrbased, {
              version: data.seerrVersion,
            })
          : undefined
      }
      className="flex items-center gap-2.5 rounded-lg bg-gray-900/60 p-2 text-gray-300 ring-1 ring-gray-700/70 transition duration-300 hover:bg-gray-800/80 hover:ring-gray-600"
    >
      <span
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${accentClass}`}
      >
        {isLocal ? (
          <CodeBracketIcon className="h-4 w-4" />
        ) : isDevelop ? (
          <BeakerIcon className="h-4 w-4" />
        ) : (
          <ServerIcon className="h-4 w-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-100">
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`}
          />
          <span className="truncate">{versionStream}</span>
        </span>
        <span className="mt-0.5 truncate font-mono text-[10px] leading-none text-gray-400">
          {isLocal ? (
            '(⌐■_■)'
          ) : (
            <>
              v
              <code className="bg-transparent p-0">
                {data.version.replace('develop-', '')}
              </code>
            </>
          )}
        </span>
        {data.seerrVersion && data.seerrVersion !== 'unknown' && (
          <span className="mt-1 truncate text-[10px] leading-none text-gray-500">
            {intl.formatMessage(messages.seerrbased, {
              version: data.seerrVersion,
            })}
          </span>
        )}
      </span>
    </Link>
  );
};

export default VersionStatus;
