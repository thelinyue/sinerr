import { Transition } from '@headlessui/react';
import type { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const MovieRequestModal = dynamic(
  () => import('@app/components/RequestModal/MovieRequestModal'),
  { ssr: false }
);
const TvRequestModal = dynamic(
  () => import('@app/components/RequestModal/TvRequestModal'),
  { ssr: false }
);
const CollectionRequestModal = dynamic(
  () => import('@app/components/RequestModal/CollectionRequestModal'),
  { ssr: false }
);

interface RequestModalProps {
  show: boolean;
  type: 'movie' | 'tv' | 'collection';
  tmdbId: number;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onComplete?: (newStatus: MediaStatus) => void;
  onCancel?: () => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const RequestModal = ({
  type,
  show,
  tmdbId,
  editRequest,
  onComplete,
  onUpdating,
  onCancel,
}: RequestModalProps) => {
  const [renderContent, setRenderContent] = useState(show);

  useEffect(() => {
    if (show) {
      setRenderContent(true);
    }
  }, [show]);

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
      afterLeave={() => setRenderContent(false)}
    >
      {renderContent ? (
        type === 'movie' ? (
          <MovieRequestModal
            onComplete={onComplete}
            onCancel={onCancel}
            tmdbId={tmdbId}
            onUpdating={onUpdating}
            editRequest={editRequest}
          />
        ) : type === 'tv' ? (
          <TvRequestModal
            onComplete={onComplete}
            onCancel={onCancel}
            tmdbId={tmdbId}
            onUpdating={onUpdating}
            editRequest={editRequest}
          />
        ) : (
          <CollectionRequestModal
            onComplete={onComplete}
            onCancel={onCancel}
            tmdbId={tmdbId}
            onUpdating={onUpdating}
          />
        )
      ) : null}
    </Transition>
  );
};

export default RequestModal;
