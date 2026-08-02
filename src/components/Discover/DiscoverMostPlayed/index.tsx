import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { RankingPeriod } from '@server/job/refreshMostPlayedCache';
import type { MovieResult, TvResult } from '@server/models/Search';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.DiscoverMostPlayed', {
  discovermostplayed: 'Weekly Ranking',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
});

const PERIODS: { key: RankingPeriod; label: keyof typeof messages }[] = [
  { key: 'week', label: 'week' },
  { key: 'month', label: 'month' },
  { key: 'year', label: 'year' },
];

const DiscoverMostPlayed = () => {
  const intl = useIntl();
  const [period, setPeriod] = useState<RankingPeriod>('week');

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult | TvResult>('/api/v1/discover/mostplayed', {
    period,
  });

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = intl.formatMessage(messages.discovermostplayed);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-5 mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Header>{title}</Header>
        <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                period === key
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {intl.formatMessage(messages[label])}
            </button>
          ))}
        </div>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default DiscoverMostPlayed;
