import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import useSettings from '@app/hooks/useSettings';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownTrayIcon, ServerIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.UserDropdown', {
  connectioninfo: 'Connection Info',
  serveraddress: 'Server Address',
  copy: 'Copy',
  copied: 'Copied!',
  clientdownload: 'Client Download',
  downloadnow: 'Install',
  noClients: 'No client download links configured.',
  serverHelp: 'Use this address in your Emby client to connect to the server.',
});

interface ConnectionInfoModalProps {
  show: boolean;
  onClose: () => void;
}

const ConnectionInfoModal = ({ show, onClose }: ConnectionInfoModalProps) => {
  const intl = useIntl();
  const settings = useSettings();
  const [copied, setCopied] = useState(false);

  const serverUrl =
    settings.currentSettings.serverConnectionUrl ||
    settings.currentSettings.jellyfinExternalHost ||
    settings.currentSettings.jellyfinHost ||
    '';

  const downloads = settings.currentSettings.clientDownloadUrls || [];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        title={intl.formatMessage(messages.connectioninfo)}
        onCancel={onClose}
        onOk={onClose}
        okText="Close"
      >
        <div className="space-y-6">
          {serverUrl && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ServerIcon className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-semibold text-gray-300">
                  {intl.formatMessage(messages.serveraddress)}
                </h3>
              </div>
              <div className="mb-2 flex gap-2">
                <div className="flex-[2]">
                  <span className="mb-0.5 block text-xs text-gray-500">
                    主机地址
                  </span>
                  <div className="rounded-lg bg-gray-700/50 p-2.5">
                    <span className="break-all font-mono text-sm text-white">
                      {serverUrl.replace(/:\d+$/, '').replace(/\/$/, '')}
                    </span>
                  </div>
                </div>
                <div className="flex-1">
                  <span className="mb-0.5 block text-xs text-gray-500">
                    端口号
                  </span>
                  <div className="rounded-lg bg-gray-700/50 p-2.5">
                    <span className="font-mono text-sm text-white">
                      {serverUrl.match(/:(\d+)/)?.[1] || '443'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={handleCopy}
                >
                  {copied
                    ? intl.formatMessage(messages.copied)
                    : intl.formatMessage(messages.copy)}
                </Button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {intl.formatMessage(messages.serverHelp)}
              </p>
            </div>
          )}

          {downloads.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ArrowDownTrayIcon className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-semibold text-gray-300">
                  {intl.formatMessage(messages.clientdownload)}
                </h3>
              </div>
              <div className="space-y-2">
                {downloads.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 rounded-lg bg-gray-700/50 p-3"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-2xl">
                      {item.icon || '📱'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {item.name}
                      </p>
                      <p className="truncate text-xs text-gray-400">
                        {item.url}
                      </p>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button buttonType="primary" buttonSize="sm">
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        <span>{intl.formatMessage(messages.downloadnow)}</span>
                      </Button>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!serverUrl && downloads.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">
              {intl.formatMessage(messages.noClients)}
            </p>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default ConnectionInfoModal;
