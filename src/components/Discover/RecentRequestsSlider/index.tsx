import { sliderTitles } from '@app/components/Discover/constants';
import RequestCard from '@app/components/RequestCard';
import Slider from '@app/components/Slider';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowRightCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import type { RequestResultsResponse } from '@server/interfaces/api/requestInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentRequestsSlider', {
  unableToConnect:
    'Unable to connect to {services}. Some information may be unavailable.',
});

const RecentRequestsSlider = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { data: requests, error: requestError } =
    useSWR<RequestResultsResponse>(
      '/api/v1/request?filter=all&take=10&sort=added&skip=0',
      {
        revalidateOnMount: true,
      }
    );

  if (requests && requests.results.length === 0 && !requestError) {
    return null;
  }

  const hasServiceErrors = false;

  return (
    <>
      <div className="slider-header">
        <Link href="/requests?filter=all" className="slider-title">
          <span>{intl.formatMessage(sliderTitles.recentrequests)}</span>
          <ArrowRightCircleIcon />
        </Link>
      </div>

      {hasServiceErrors &&
        (hasPermission(Permission.MANAGE_REQUESTS) ||
          hasPermission(Permission.REQUEST_ADVANCED)) && (
          <div className="service-error-banner">
            <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
            <span>
              {intl.formatMessage(messages.unableToConnect, {
                services: '',
              })}
            </span>
          </div>
        )}

      <Slider
        sliderKey="requests"
        isLoading={!requests}
        items={(requests?.results ?? []).map((request) => (
          <RequestCard
            key={`request-slider-item-${request.id}`}
            request={request}
          />
        ))}
        placeholder={<RequestCard.Placeholder />}
      />
    </>
  );
};

export default RecentRequestsSlider;
