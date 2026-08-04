import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import ConnectionGuide from '@app/components/Discover/ConnectionGuide';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
});

const Search = () => {
  const intl = useIntl();
  const router = useRouter();

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult | TvResult | PersonResult>(
    `/api/v1/search`,
    {
      query: router.query.query,
    },
    { hideAvailable: false, hideBlocklisted: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const isEmptyQuery = !router.query.query;

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      {/* 方案 A：引导在空查询 / 无结果时出现（不常驻首页横幅） */}
      {(isEmptyQuery || isEmpty) && <ConnectionGuide embedded />}
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
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

export default Search;
