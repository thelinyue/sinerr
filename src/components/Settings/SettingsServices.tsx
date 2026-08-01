import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import MediaryModal from '@app/components/Settings/MediaryModal';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  CloudIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type {
  MediaryServerSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings', {
  services: 'Services',

  mediarysettings: 'Mediary Settings',
  serviceSettingsDescription:
    'Configure your {serverType} server(s) below. You can connect multiple {serverType} servers, but only two of them can be marked as defaults (one non-4K and one 4K). Administrators are able to override the server used to process new requests prior to approval.',

  mediarySettingsDescription: 'Configure Mediary connection settings',
  deleteserverconfirm: 'Are you sure you want to delete this server?',
  ssl: 'SSL',
  default: 'Default',
  default4k: 'Default 4K',
  is4k: '4K',
  address: 'Address',
  activeProfile: 'Active Profile',

  addmediary: 'Add Mediary Server',
  noDefaultServer:
    'At least one {serverType} server must be marked as default in order for {mediaType} requests to be processed.',
  noDefaultNon4kServer:
    'If you only have a single {serverType} server for both non-4K and 4K content (or if you only download 4K content), your {serverType} server should <strong>NOT</strong> be designated as a 4K server.',
  noDefault4kServer:
    'A 4K {serverType} server must be marked as default in order to enable users to submit 4K {mediaType} requests.',
  mediaTypeMovie: 'movie',
  mediaTypeSeries: 'series',
  deleteServer: 'Delete {serverType} Server',
});

interface ServerInstanceProps {
  name: string;
  isDefault?: boolean;
  is4k?: boolean;
  hostname: string;
  port: number;
  isSSL?: boolean;
  externalUrl?: string;
  profileName?: string;
  isMoviepilot?: boolean;
  isMediary?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export interface DVRTestResponse {
  profiles: {
    id: number;
    name: string;
  }[];
  rootFolders: {
    id: number;
    path: string;
  }[];
  tags: {
    id: number;
    label: string;
  }[];
  urlBase?: string;
}



const ServerInstance = ({
  name,
  hostname,
  port,
  profileName,
  is4k = false,
  isDefault = false,
  isSSL = false,
  isMediary = false,
  externalUrl,
  onEdit,
  onDelete,
}: ServerInstanceProps) => {
  const intl = useIntl();

  const internalUrl =
    (isSSL ? 'https://' : 'http://') + hostname + ':' + String(port);
  const serviceUrl = externalUrl ?? internalUrl;

  return (
    <li className="col-span-1 rounded-lg bg-gray-800 shadow ring-1 ring-gray-500">
      <div className="flex w-full items-center justify-between space-x-6 p-6">
        <div className="flex-1 truncate">
          <div className="mb-2 flex items-center space-x-2">
            <h3 className="truncate font-medium leading-5 text-white">
              <a
                href={serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition duration-300 hover:text-white hover:underline"
              >
                {name}
              </a>
            </h3>
            {isDefault && !is4k && (
              <Badge>{intl.formatMessage(messages.default)}</Badge>
            )}
            {isDefault && is4k && (
              <Badge>{intl.formatMessage(messages.default4k)}</Badge>
            )}
            {!isDefault && is4k && (
              <Badge badgeType="warning">
                {intl.formatMessage(messages.is4k)}
              </Badge>
            )}
            {isSSL && (
              <Badge badgeType="success">
                {intl.formatMessage(messages.ssl)}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm leading-5 text-gray-300">
            <span className="mr-2 font-bold">
              {intl.formatMessage(messages.address)}
            </span>
            <a
              href={internalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition duration-300 hover:text-white hover:underline"
            >
              {internalUrl}
            </a>
          </p>
          {profileName && (
            <p className="mt-1 truncate text-sm leading-5 text-gray-300">
              <span className="mr-2 font-bold">
                {intl.formatMessage(messages.activeProfile)}
              </span>
              {profileName}
            </p>
          )}
        </div>
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-50 hover:opacity-100"
        >
          {isMediary && (
            <CloudIcon className="h-10 w-10 flex-shrink-0 text-indigo-500" />
          )}
        </a>
      </div>
      <div className="border-t border-gray-500">
        <div className="-mt-px flex">
          <div className="flex w-0 flex-1 border-r border-gray-500">
            <button
              onClick={() => onEdit()}
              className="focus:ring-blue relative -mr-px inline-flex w-0 flex-1 items-center justify-center rounded-bl-lg border border-transparent py-4 text-sm font-medium leading-5 text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
            >
              <PencilIcon className="mr-2 h-5 w-5" />
              <span>{intl.formatMessage(globalMessages.edit)}</span>
            </button>
          </div>
          <div className="-ml-px flex w-0 flex-1">
            <button
              onClick={() => onDelete()}
              className="focus:ring-blue relative inline-flex w-0 flex-1 items-center justify-center rounded-br-lg border border-transparent py-4 text-sm font-medium leading-5 text-gray-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-gray-500 focus:outline-none"
            >
              <TrashIcon className="mr-2 h-5 w-5" />
              <span>{intl.formatMessage(globalMessages.delete)}</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
};

const SettingsServices = () => {
  const intl = useIntl();
  const {
    data: mediaryData,
    error: mediaryError,
    mutate: revalidateMediary,
  } = useSWR<MediaryServerSettings[]>('/api/v1/settings/mediary');
  const [editMediaryModal, setEditMediaryModal] = useState<{
    open: boolean;
    mediary: MediaryServerSettings | null;
  }>({
    open: false,
    mediary: null,
  });
  const [deleteServerModal, setDeleteServerModal] = useState<{
    open: boolean;
    type: 'mediary';
    serverId: number | null;
  }>({
    open: false,
    type: 'mediary',
    serverId: null,
  });

  const deleteServer = async () => {
    await axios.delete(
      `/api/v1/settings/${deleteServerModal.type}/${deleteServerModal.serverId}`
    );
    setDeleteServerModal({ open: false, serverId: null, type: 'mediary' });
    revalidateMediary();
    mutate('/api/v1/settings/public');
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.services),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      {editMediaryModal.open && (
        <MediaryModal
          mediary={editMediaryModal.mediary}
          onClose={() => {
            setEditMediaryModal({ open: false, mediary: null });
          }}
          onSave={() => {
            revalidateMediary();
            mutate('/api/v1/settings/public');
            setEditMediaryModal({ open: false, mediary: null });
          }}
        />
      )}
      <Transition
        as={Fragment}
        show={deleteServerModal.open}
        enter="transition-opacity ease-in-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-in-out duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Modal
          okText={intl.formatMessage(globalMessages.delete)}
          okButtonType="danger"
          onOk={() => deleteServer()}
          onCancel={() =>
            setDeleteServerModal({
              open: false,
              serverId: null,
              type: 'mediary',
            })
          }
          title={intl.formatMessage(messages.deleteServer, {
            serverType:
              deleteServerModal.type === 'mediary' ? 'Mediary' : 'Mediary',
          })}
        >
          {intl.formatMessage(messages.deleteserverconfirm)}
        </Modal>
      </Transition>
      <div className="mb-6 mt-10">
        <h3 className="heading">
          {intl.formatMessage(messages.mediarysettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.mediarySettingsDescription)}
        </p>
      </div>
      <div className="section">
        {!mediaryData && !mediaryError && <LoadingSpinner />}
        {mediaryError && (
          <Alert title="Failed to load Mediary settings" type="error" />
        )}
        {mediaryData && !mediaryError ? (
          <>
            {mediaryData.length > 0 &&
              !mediaryData.some((m) => m.isDefault) && (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Mediary',
                    mediaType: intl.formatMessage(messages.mediaTypeMovie),
                  })}
                />
              )}
            <ul className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {mediaryData.map((m) => (
                <ServerInstance
                  key={`mediary-config-${m.id}`}
                  name={m.name}
                  hostname={m.hostname}
                  port={m.port}
                  isSSL={m.useSsl}
                  isDefault={m.isDefault}
                  isMediary
                  externalUrl={m.externalUrl}
                  onEdit={() => setEditMediaryModal({ open: true, mediary: m })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: m.id,
                      type: 'mediary',
                    })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="ghost"
                    onClick={() =>
                      setEditMediaryModal({ open: true, mediary: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addmediary)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        ) : null}
      </div>
    </>
  );
};

export default SettingsServices;
