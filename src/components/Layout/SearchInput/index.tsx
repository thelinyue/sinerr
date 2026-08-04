import ConnectionGuide from '@app/components/Discover/ConnectionGuide';
import useSearchInput from '@app/hooks/useSearchInput';
import defineMessages from '@app/utils/defineMessages';
import { XCircleIcon } from '@heroicons/react/24/outline';
import { MagnifyingGlassIcon } from '@heroicons/react/24/solid';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Layout.SearchInput', {
  searchPlaceholder: 'Search Movies & Series',
});

const SearchInput = () => {
  const intl = useIntl();
  const { searchValue, searchOpen, setSearchValue, setIsOpen, clear } =
    useSearchInput();
  return (
    <div className="relative flex flex-1">
      <div className="flex w-full">
        <label htmlFor="search_field" className="sr-only">
          Search
        </label>
        <div className="relative flex w-full items-center text-white focus-within:text-gray-200">
          <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
            <MagnifyingGlassIcon className="h-5 w-5" />
          </div>
          <input
            id="search_field"
            style={{ paddingRight: searchValue.length > 0 ? '1.75rem' : '' }}
            className="block w-full rounded-full border border-gray-600 bg-gray-900/80 py-2 pl-10 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0 sm:text-base"
            placeholder={intl.formatMessage(messages.searchPlaceholder)}
            type="search"
            autoComplete="off"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              if (searchValue === '') {
                setIsOpen(false);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchValue.length > 0 && (
            <button
              className="absolute inset-y-0 right-2 m-auto h-7 w-7 border-none p-1 text-gray-400 outline-none transition hover:text-white focus:border-none focus:outline-none"
              onClick={() => clear()}
            >
              <XCircleIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {searchOpen && searchValue === '' && (
        <>
          {/* 聚焦遮罩：压暗页面突出观影指南，点击关闭 */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- 遮罩用 div 覆盖全屏，点击即关闭 */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setIsOpen(false)}
          />
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 防止点击引导卡片触发输入框 blur 先行卸载 */}
          <div
            className="fixed inset-x-3 top-16 z-50 max-h-[75vh] overflow-y-auto rounded-xl bg-gray-900/95 shadow-2xl ring-1 ring-gray-700 sm:absolute sm:inset-x-0 sm:top-full sm:mt-2 sm:max-w-lg"
            onMouseDown={(e) => e.preventDefault()}
          >
            <ConnectionGuide embedded />
          </div>
        </>
      )}
    </div>
  );
};

export default SearchInput;
