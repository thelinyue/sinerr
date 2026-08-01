import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Tooltip from '@app/components/Common/Tooltip';
import CreateSlider from '@app/components/Discover/CreateSlider';
import DiscoverSliderEdit from '@app/components/Discover/DiscoverSliderEdit';
import MovieGenreSlider from '@app/components/Discover/MovieGenreSlider';
import NetworkSlider from '@app/components/Discover/NetworkSlider';
import RecentRequestsSlider from '@app/components/Discover/RecentRequestsSlider';
import RecentlyAddedSlider from '@app/components/Discover/RecentlyAddedSlider';
import StudioSlider from '@app/components/Discover/StudioSlider';
import TvGenreSlider from '@app/components/Discover/TvGenreSlider';
import { sliderTitles } from '@app/components/Discover/constants';
import MediaSlider from '@app/components/MediaSlider';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import {
  ArrowDownOnSquareIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  PencilIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';
import { DiscoverSliderType } from '@server/constants/discover';
import type DiscoverSlider from '@server/entity/DiscoverSlider';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover', {
  discover: 'Discover',
  resettodefault: 'Reset to Default',
  resetwarning:
    'Reset all sliders to default. This will also delete any custom sliders!',
  updatesuccess: 'Updated discover customization settings.',
  updatefailed:
    'Something went wrong updating the discover customization settings.',
  resetsuccess: 'Sucessfully reset discover customization settings.',
  resetfailed:
    'Something went wrong resetting the discover customization settings.',
  customizediscover: 'Customize Discover',
  stopediting: 'Stop Editing',
  createnewslider: 'Create New Slider',
});

const Discover = () => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const { addToast } = useToasts();
  const {
    data: discoverData,
    error: discoverError,
    mutate,
  } = useSWR<DiscoverSlider[]>('/api/v1/settings/discover');
  const [sliders, setSliders] = useState<Partial<DiscoverSlider>[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // We need to sync the state here so that we can modify the changes locally without commiting
  // anything to the server until the user decides to save the changes
  useEffect(() => {
    if (discoverData && !isEditing) {
      setSliders(discoverData);
    }
  }, [discoverData, isEditing]);

  const hasChanged = () =>
    JSON.stringify(discoverData) !== JSON.stringify(sliders);

  const updateSliders = async () => {
    try {
      await axios.post('/api/v1/settings/discover', sliders);

      addToast(intl.formatMessage(messages.updatesuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      await mutate();
      setIsEditing(false);
    } catch {
      addToast(intl.formatMessage(messages.updatefailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const resetSliders = async () => {
    try {
      await axios.get('/api/v1/settings/discover/reset');

      addToast(intl.formatMessage(messages.resetsuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      setIsEditing(false);
      mutate();
    } catch {
      addToast(intl.formatMessage(messages.resetfailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const upcomingDate = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  if (!discoverData && !discoverError) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.discover)} />
      {hasPermission(Permission.ADMIN) && (
        <>
          {isEditing && (
            <div className="my-6 rounded-lg bg-gray-800">
              <div className="flex items-center space-x-2 rounded-t-lg border-l border-r border-t border-gray-800 bg-gray-900 p-4 text-lg font-semibold text-gray-400">
                <PlusIcon className="w-6" />
                <span data-testid="create-slider-header">
                  {intl.formatMessage(messages.createnewslider)}
                </span>
              </div>
              <div className="p-4">
                <CreateSlider
                  onCreate={async () => {
                    const newSliders = await mutate();

                    if (newSliders) {
                      setSliders(newSliders);
                    }
                  }}
                />
              </div>
            </div>
          )}
          <Transition
            show={!isEditing}
            enter="transition-opacity duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            className="absolute-bottom-shift fixed right-6 z-50 flex items-center sm:bottom-8"
          >
            <button
              onClick={() => setIsEditing(true)}
              data-testid="discover-start-editing"
              className="h-12 w-12 rounded-full border-2 border-gray-600 bg-gray-700/90 p-3 text-gray-400 shadow transition-all hover:bg-gray-700"
            >
              <PencilIcon className="h-full w-full" />
            </button>
          </Transition>
          <Transition
            show={isEditing}
            enter="transition duration-300"
            enterFrom="opacity-0 translate-y-6"
            enterTo="opacity-100 translate-y-0"
            leave="transition duration-300"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-6"
            className="safe-shift-edit-menu fixed left-0 right-0 z-50 flex flex-col items-center justify-end space-x-0 space-y-2 border-t border-gray-700 bg-gray-800/80 p-4 backdrop-blur sm:bottom-0 sm:flex-row sm:space-x-3 sm:space-y-0"
          >
            <Button
              buttonType="default"
              onClick={() => setIsEditing(false)}
              className="w-full sm:w-auto"
            >
              <ArrowUturnLeftIcon />
              <span>{intl.formatMessage(messages.stopediting)}</span>
            </Button>
            <Tooltip content={intl.formatMessage(messages.resetwarning)}>
              <ConfirmButton
                onClick={() => resetSliders()}
                confirmText={intl.formatMessage(globalMessages.areyousure)}
                className="w-full sm:w-auto"
              >
                <ArrowPathIcon />
                <span>{intl.formatMessage(messages.resettodefault)}</span>
              </ConfirmButton>
            </Tooltip>
            <Button
              buttonType="primary"
              type="submit"
              disabled={!hasChanged()}
              onClick={() => updateSliders()}
              data-testid="discover-customize-submit"
              className="w-full sm:w-auto"
            >
              <ArrowDownOnSquareIcon />
              <span>{intl.formatMessage(globalMessages.save)}</span>
            </Button>
          </Transition>
        </>
      )}

      <ConnectionGuide />

      {(isEditing ? sliders : discoverData)?.map((slider, index) => {
        let sliderComponent: React.ReactNode;
        switch (slider.type) {
          case DiscoverSliderType.RECENTLY_ADDED:
            sliderComponent = <RecentlyAddedSlider />;
            break;
          case DiscoverSliderType.RECENT_REQUESTS:
            sliderComponent = <RecentRequestsSlider />;
            break;
          case DiscoverSliderType.TRENDING:
            sliderComponent = (
              <MediaSlider
                sliderKey="trending"
                title={intl.formatMessage(sliderTitles.trending)}
                url="/api/v1/discover/trending"
                linkUrl="/discover/trending"
              />
            );
            break;
          case DiscoverSliderType.POPULAR_MOVIES:
            sliderComponent = (
              <MediaSlider
                sliderKey="popular-movies"
                title={intl.formatMessage(sliderTitles.popularmovies)}
                url="/api/v1/discover/movies"
                linkUrl="/discover/movies"
              />
            );
            break;
          case DiscoverSliderType.MOVIE_GENRES:
            sliderComponent = <MovieGenreSlider />;
            break;
          case DiscoverSliderType.UPCOMING_MOVIES:
            sliderComponent = (
              <MediaSlider
                sliderKey="upcoming"
                title={intl.formatMessage(sliderTitles.upcoming)}
                linkUrl={`/discover/movies?primaryReleaseDateGte=${upcomingDate}`}
                url="/api/v1/discover/movies"
                extraParams={`primaryReleaseDateGte=${upcomingDate}`}
              />
            );
            break;
          case DiscoverSliderType.STUDIOS:
            sliderComponent = <StudioSlider />;
            break;
          case DiscoverSliderType.POPULAR_TV:
            sliderComponent = (
              <MediaSlider
                sliderKey="popular-tv"
                title={intl.formatMessage(sliderTitles.populartv)}
                url="/api/v1/discover/tv"
                linkUrl="/discover/tv"
              />
            );
            break;
          case DiscoverSliderType.TV_GENRES:
            sliderComponent = <TvGenreSlider />;
            break;
          case DiscoverSliderType.UPCOMING_TV:
            sliderComponent = (
              <MediaSlider
                sliderKey="upcoming-tv"
                title={intl.formatMessage(sliderTitles.upcomingtv)}
                linkUrl={`/discover/tv?firstAirDateGte=${upcomingDate}`}
                url="/api/v1/discover/tv"
                extraParams={`firstAirDateGte=${upcomingDate}`}
              />
            );
            break;
          case DiscoverSliderType.NETWORKS:
            sliderComponent = <NetworkSlider />;
            break;
          case DiscoverSliderType.TMDB_MOVIE_KEYWORD:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/movies"
                extraParams={
                  slider.data
                    ? `keywords=${encodeURIExtraParams(slider.data)}`
                    : ''
                }
                linkUrl={`/discover/movies?keywords=${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_KEYWORD:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/tv"
                extraParams={
                  slider.data
                    ? `keywords=${encodeURIExtraParams(slider.data)}`
                    : ''
                }
                linkUrl={`/discover/tv?keywords=${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_GENRE:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/movies`}
                extraParams={`genre=${slider.data}`}
                linkUrl={`/discover/movies?genre=${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_GENRE:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/tv`}
                extraParams={`genre=${slider.data}`}
                linkUrl={`/discover/tv?genre=${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_STUDIO:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/movies/studio/${slider.data}`}
                linkUrl={`/discover/movies/studio/${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_NETWORK:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url={`/api/v1/discover/tv/network/${slider.data}`}
                linkUrl={`/discover/tv/network/${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_SEARCH:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/search"
                extraParams={`query=${slider.data}`}
                linkUrl={`/search?query=${slider.data}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_MOVIE_STREAMING_SERVICES:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/movies"
                extraParams={`watchRegion=${
                  slider.data?.split(',')[0]
                }&watchProviders=${slider.data?.split(',')[1]}`}
                linkUrl={`/discover/movies?watchRegion=${
                  slider.data?.split(',')[0]
                }&watchProviders=${slider.data?.split(',')[1]}`}
              />
            );
            break;
          case DiscoverSliderType.TMDB_TV_STREAMING_SERVICES:
            sliderComponent = (
              <MediaSlider
                sliderKey={`custom-slider-${slider.id}`}
                title={slider.title ?? ''}
                url="/api/v1/discover/tv"
                extraParams={`watchRegion=${
                  slider.data?.split(',')[0]
                }&watchProviders=${slider.data?.split(',')[1]}`}
                linkUrl={`/discover/tv?watchRegion=${
                  slider.data?.split(',')[0]
                }&watchProviders=${slider.data?.split(',')[1]}`}
              />
            );
            break;
          case DiscoverSliderType.MOST_PLAYED:
            sliderComponent = (
              <MediaSlider
                sliderKey="mostplayed"
                title={intl.formatMessage(sliderTitles.mostplayed)}
                url="/api/v1/discover/mostplayed"
                extraParams="period=week"
                linkUrl="/discover/mostplayed"
              />
            );
            break;
        }

        if (isEditing) {
          return (
            <DiscoverSliderEdit
              key={`discover-slider-${slider.id}-edit`}
              slider={slider}
              onDelete={async () => {
                const newSliders = await mutate();

                if (newSliders) {
                  setSliders(newSliders);
                }
              }}
              onEnable={() => {
                const tempSliders = sliders.slice();
                tempSliders[index] = {
                  ...tempSliders[index],
                  enabled: !tempSliders[index].enabled,
                };
                setSliders(tempSliders);
              }}
              onPositionUpdate={(updatedItemId, position, hasClickedArrows) => {
                const originalPosition = sliders.findIndex(
                  (item) => item.id === updatedItemId
                );
                const originalItem = sliders[originalPosition];

                const tempSliders = sliders.slice();

                tempSliders.splice(originalPosition, 1);
                if (hasClickedArrows) {
                  tempSliders.splice(
                    position === 'Above' ? index - 1 : index + 1,
                    0,
                    originalItem
                  );
                } else {
                  tempSliders.splice(
                    position === 'Above' && index > originalPosition
                      ? Math.max(index - 1, 0)
                      : index,
                    0,
                    originalItem
                  );
                }

                setSliders(tempSliders);
              }}
              disableUpButton={index === 0}
              disableDownButton={index === sliders.length - 1}
            >
              {sliderComponent}
            </DiscoverSliderEdit>
          );
        }

        if (!slider.enabled) {
          return null;
        }

        return (
          <div key={`discover-slider-${slider.id}`}>{sliderComponent}</div>
        );
      })}
    </>
  );
};

const ConnectionGuide = () => {
  const settings = useSettings();
  const { user } = useUser();
  const [dismissed, setDismissed] = useState(true);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem('connection-guide-dismissed') === 'true');
    } catch {
      setDismissed(true);
    }
  }, []);

  const serverUrl =
    settings.currentSettings.serverConnectionUrl ||
    settings.currentSettings.jellyfinExternalHost ||
    settings.currentSettings.jellyfinHost;

  const downloads = settings.currentSettings.clientDownloadUrls || [];

  if (dismissed || (!serverUrl && downloads.length === 0)) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem('connection-guide-dismissed', 'true');
    } catch {
      // localStorage may not be available
    }
    setDismissed(true);
  };

  return (
    <Transition
      as="div"
      show={!dismissed}
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
    >
      <div className="mx-4 mb-6 rounded-lg border border-indigo-500/30 bg-gradient-to-r from-indigo-600/30 to-purple-600/30 p-5">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-white">
            <span className="mr-2">📺</span>如何开始观看？
          </h2>
          <button
            onClick={dismiss}
            className="flex-shrink-0 text-sm text-gray-400 hover:text-white"
          >
            不再显示
          </button>
        </div>
        <div className="space-y-4">
          {downloads.length > 0 && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                1
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-sm font-medium text-white">
                  下载客户端
                </p>
                <div className="flex flex-col gap-3">
                  {downloads.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg bg-gray-700/50 p-3"
                    >
                      <div className="flex h-14 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg p-1">
                        {/^https?:\/\//.test(d.icon) ? (
                          <img
                            src={d.icon}
                            alt={d.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-2xl">{d.icon || '📱'}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white">
                          {d.name}
                        </p>
                      </div>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0"
                      >
                        <Button buttonType="primary" buttonSize="sm">
                          <ArrowDownTrayIcon className="mr-1 h-4 w-4" />
                          下载
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {serverUrl && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-bold text-white">
                {downloads.length > 0 ? '2' : '1'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-sm font-medium text-white">
                  输入服务器地址
                </p>
                <div className="mb-2 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-gray-800/80 px-3 py-1.5 font-mono text-xs text-gray-300">
                    {serverUrl}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(serverUrl).catch(() => {
                        // clipboard permission denied
                      });
                    }}
                    className="flex-shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-indigo-500"
                  >
                    复制
                  </button>
                </div>
                <p className="text-xs text-yellow-400/90">
                  ⚠ 默认端口号为 <strong>443</strong>，如连接失败请检查端口设置
                </p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
              {downloads.length > 0 ? '3' : '2'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-sm font-medium text-white">登录 Emby</p>
              <p className="mb-2 text-xs text-gray-300">
                使用当前账号
                <strong className="mx-1 text-white">
                  {user?.displayName || user?.username || '用户名'}
                </strong>
                和密码登录，首次登录建议勾选"记住我"
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => setShowDemo(!showDemo)}
                  className="inline-flex items-center text-xs text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  {showDemo ? '收起示例' : '查看连接示例'}
                </button>
              </div>
            </div>
          </div>

          {showDemo && (
            <div className="overflow-hidden rounded-lg border border-gray-600 bg-gray-800/80">
              <div className="flex items-center gap-2 bg-gray-700 px-4 py-2">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                </div>
                <span className="ml-2 text-xs text-gray-400">
                  Emby 客户端 — 连接服务器
                </span>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex gap-3">
                  <div className="flex-[2]">
                    <span className="mb-1 block text-xs text-gray-500">
                      主机地址
                    </span>
                    <div className="truncate rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-green-400">
                      {serverUrl
                        ? serverUrl.replace(/:\d+$/, '').replace(/\/$/, '')
                        : 'your-server.com'}
                    </div>
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-gray-500">
                      端口号
                    </span>
                    <div className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-white">
                      {serverUrl
                        ? serverUrl.match(/:(\d+)/)?.[1] || '443'
                        : '443'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-gray-500">
                      用户名
                    </span>
                    <div className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-white">
                      {user?.displayName || user?.username || 'username'}
                    </div>
                  </div>
                  <div className="flex-1">
                    <span className="mb-1 block text-xs text-gray-500">
                      密码
                    </span>
                    <div className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 font-mono text-xs text-white">
                      ••••••••
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    defaultChecked
                    readOnly
                    className="rounded border-gray-600"
                  />
                  记住我
                </div>
                <div className="rounded bg-indigo-600 py-2 text-center text-sm font-medium text-white">
                  登录
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Transition>
  );
};

export default Discover;
