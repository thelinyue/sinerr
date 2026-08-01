import Slider from '@app/components/Slider';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import defineMessages from '@app/utils/defineMessages';
import type { MediaResultsResponse } from '@server/interfaces/api/mediaInterfaces';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.RecentlyAddedSlider', {
  recentlyAdded: 'Recently Added',
});

const RecentlyAddedSlider = () => {
  const intl = useIntl();
  const { data: media, error: mediaError } = useSWR<MediaResultsResponse>(
    '/api/v1/media?filter=allavailable&take=20&sort=mediaAdded',
    { revalidateOnMount: true }
  );

  if (media && !media.results.length && !mediaError) {
    return null;
  }

  return (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.recentlyAdded)}</span>
        </div>
      </div>
      <Slider
        sliderKey="media"
        isLoading={!media}
        items={(media?.results ?? []).map((item, index) => (
          <TmdbTitleCard
            key={`media-slider-item-${item.id}`}
            id={item.id}
            tmdbId={item.tmdbId}
            tvdbId={item.tvdbId}
            type={item.mediaType}
            priority={index < 4}
          />
        ))}
      />
    </>
  );
};

export default RecentlyAddedSlider;
