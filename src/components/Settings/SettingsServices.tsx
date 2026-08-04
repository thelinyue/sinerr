import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import MoviePilotModal from '@app/components/Settings/MoviePilotModal';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import {
  CloudIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type { MoviePilotServerSettings } from '@server/lib/settings';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Settings', {
  services: 'Services',
  moviepilotsettings: 'MoviePilot Settings',
  moviepilotSettingsDescription: 'Configure MoviePilot connection settings',
  deleteserverconfirm: 'Are you sure you want to delete this server?',
  ssl: 'SSL',
  default: 'Default',
  address: 'Address',
  activeProfile: 'Active Profile',
  addmoviepilot: 'Add MoviePilot Server',
  noDefaultServer:
    'At least one {serverType} server must be marked as default in order for {mediaType} requests to be processed.',
  mediaTypeMovie: 'movie',
  mediaTypeSeries: 'series',
  deleteServer: 'Delete {serverType} Server',
});

interface ServerInstanceProps {
  name: string;
  isDefault?: boolean;
  hostname: string;
  port: number;
  isSSL?: boolean;
  externalUrl?: string;
  profileName?: string;
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
  isDefault = false,
  isSSL = false,
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
            {isDefault && <Badge>{intl.formatMessage(messages.default)}</Badge>}
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
          <CloudIcon className="h-10 w-10 flex-shrink-0 text-indigo-500" />
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
    data: moviepilotData,
    error: moviepilotError,
    mutate: revalidateMoviePilot,
  } = useSWR<MoviePilotServerSettings[]>('/api/v1/settings/moviepilot');
  const [editMoviePilotModal, setEditMoviePilotModal] = useState<{
    open: boolean;
    moviepilot: MoviePilotServerSettings | null;
  }>({
    open: false,
    moviepilot: null,
  });
  const [deleteServerModal, setDeleteServerModal] = useState<{
    open: boolean;
    serverId: number | null;
  }>({
    open: false,
    serverId: null,
  });

  const deleteServer = async () => {
    await axios.delete(
      `/api/v1/settings/moviepilot/${deleteServerModal.serverId}`
    );
    setDeleteServerModal({ open: false, serverId: null });
    revalidateMoviePilot();
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
      {editMoviePilotModal.open && (
        <MoviePilotModal
          moviepilot={editMoviePilotModal.moviepilot}
          onClose={() => {
            setEditMoviePilotModal({ open: false, moviepilot: null });
          }}
          onSave={() => {
            revalidateMoviePilot();
            mutate('/api/v1/settings/public');
            setEditMoviePilotModal({ open: false, moviepilot: null });
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
          onCancel={() => setDeleteServerModal({ open: false, serverId: null })}
          title={intl.formatMessage(messages.deleteServer, {
            serverType: 'MoviePilot',
          })}
        >
          {intl.formatMessage(messages.deleteserverconfirm)}
        </Modal>
      </Transition>
      <div className="mb-6 mt-10">
        <h3 className="heading">
          {intl.formatMessage(messages.moviepilotsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.moviepilotSettingsDescription)}
        </p>
      </div>
      <div className="section">
        {!moviepilotData && !moviepilotError && <LoadingSpinner />}
        {moviepilotError && (
          <Alert title="Failed to load MoviePilot settings" type="error" />
        )}
        {moviepilotData && !moviepilotError && (
          <>
            {moviepilotData.length > 0 &&
              !moviepilotData.some((m) => m.isDefault) && (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'MoviePilot',
                    mediaType: intl.formatMessage(messages.mediaTypeMovie),
                  })}
                />
              )}
            <ul className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {moviepilotData.map((m) => (
                <ServerInstance
                  key={`moviepilot-config-${m.id}`}
                  name={m.name}
                  hostname={m.hostname}
                  port={m.port}
                  isSSL={m.useSsl}
                  isDefault={m.isDefault}
                  externalUrl={m.externalUrl}
                  onEdit={() =>
                    setEditMoviePilotModal({ open: true, moviepilot: m })
                  }
                  onDelete={() =>
                    setDeleteServerModal({ open: true, serverId: m.id })
                  }
                />
              ))}
              <li className="col-span-1 h-32 rounded-lg border-2 border-dashed border-gray-400 shadow sm:h-44">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="ghost"
                    onClick={() =>
                      setEditMoviePilotModal({ open: true, moviepilot: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addmoviepilot)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
    </>
  );
};

export default SettingsServices;
