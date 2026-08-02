import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { isValidURL } from '@app/utils/urlValidationHelper';
import { Transition } from '@headlessui/react';
import type { MoviePilotServerSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import Select from 'react-select';
import * as Yup from 'yup';

const messages = defineMessages('components.Settings.MoviePilotModal', {
  createmoviepilot: 'Add New MoviePilot Server',
  editmoviepilot: 'Edit MoviePilot Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  toastMoviePilotTestSuccess: 'MoviePilot connection successful!',
  toastMoviePilotTestFailure: 'Failed to connect to MoviePilot.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  externalUrl: 'External URL',
  syncEnabled: 'Enable Scan',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'URL base must have a leading slash',
  validationBaseUrlTrailingSlash: 'URL base must not end in a trailing slash',
  apiKeyHelp: 'Find your MoviePilot API key in Settings > Security > API Key.',
  baseUrlHelp:
    'If you set a URL Base in MoviePilot, enter it here (e.g. /mp). Leave blank otherwise.',
  externalUrlHelp:
    'For clickable links on media pages when the hostname is not reachable from outside your network.',
  syncEnabledHelp:
    'Scan MoviePilot for existing media and request status so users cannot request content already available.',
  requestConfigTitle: 'Request Configuration',
  requestConfigDescription:
    'Applied to subscriptions pushed to this server (MoviePilot equivalents of quality profile, root folder and tags). Test the connection to load downloaders, paths and sites.',
  quality: 'Quality',
  qualityHelp: 'e.g. 2160p / 1080p / BluRay',
  resolution: 'Resolution',
  resolutionHelp: 'e.g. 4K / 1080p / 720p',
  effect: 'Video Effect',
  effectHelp: 'e.g. HDR / HDR10 / Dolby Vision',
  downloader: 'Downloader',
  downloaderHelp:
    'Which downloader MoviePilot uses for subscriptions to this server.',
  savePath: 'Save Path',
  savePathHelp: 'Download directory, from MoviePilot download paths.',
  sites: 'Sites',
  sitesHelp: 'Sites used to search subscriptions. Empty = all active sites.',
  include: 'Include Keywords',
  includeHelp:
    'Only match results containing these keywords (comma separated).',
  exclude: 'Exclude Keywords',
  excludeHelp: 'Exclude results containing these keywords (comma separated).',
});

interface MoviePilotLookupData {
  downloaders: { name: string; type?: string }[];
  paths: { name?: string; save_path?: string; media_type?: string }[];
  sites: { id: number; name?: string; domain?: string; is_active?: boolean }[];
}

interface MoviePilotModalProps {
  moviepilot: MoviePilotServerSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const MoviePilotModal = ({
  onClose,
  moviepilot,
  onSave,
}: MoviePilotModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(moviepilot ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [lookupData, setLookupData] = useState<MoviePilotLookupData | null>(
    null
  );

  const MoviePilotSettingsSchema = Yup.object().shape({
    name: Yup.string().required(
      intl.formatMessage(messages.validationNameRequired)
    ),
    hostname: Yup.string().required(
      intl.formatMessage(messages.validationHostnameRequired)
    ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationApiKeyRequired)
    ),
    externalUrl: Yup.string()
      .test(
        'valid-url',
        intl.formatMessage(messages.validationApplicationUrl),
        isValidURL
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationApplicationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    baseUrl: Yup.string()
      .test(
        'leading-slash',
        intl.formatMessage(messages.validationBaseUrlLeadingSlash),
        (value) => !value || value.startsWith('/')
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationBaseUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const testConnection = useCallback(
    async ({
      hostname,
      port,
      apiKey,
      baseUrl,
      useSsl = false,
    }: {
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl?: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<MoviePilotLookupData>(
          '/api/v1/settings/moviepilot/test',
          {
            hostname,
            apiKey,
            port: Number(port),
            baseUrl,
            useSsl,
          }
        );

        setLookupData(response.data);
        setIsValidated(true);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastMoviePilotTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch {
        setLookupData(null);
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastMoviePilotTestFailure), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      } finally {
        setIsTesting(false);
        initialLoad.current = true;
      }
    },
    [addToast, intl]
  );

  // 编辑已有服务器时，挂载即测试一次连接以加载请求级配置下拉（不弹提示）。
  useEffect(() => {
    if (moviepilot) {
      testConnection({
        hostname: moviepilot.hostname,
        port: moviepilot.port,
        apiKey: moviepilot.apiKey,
        baseUrl: moviepilot.baseUrl,
        useSsl: moviepilot.useSsl,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          name: moviepilot?.name ?? 'MoviePilot',
          hostname: moviepilot?.hostname,
          port: moviepilot?.port ?? 3000,
          ssl: moviepilot?.useSsl ?? false,
          apiKey: moviepilot?.apiKey,
          baseUrl: moviepilot?.baseUrl,
          isDefault: moviepilot?.isDefault ?? false,
          externalUrl: moviepilot?.externalUrl,
          syncEnabled: moviepilot?.syncEnabled ?? false,
          activeQuality: moviepilot?.activeQuality ?? '',
          activeResolution: moviepilot?.activeResolution ?? '',
          activeEffect: moviepilot?.activeEffect ?? '',
          activeDownloader: moviepilot?.activeDownloader ?? '',
          activeSavePath: moviepilot?.activeSavePath ?? '',
          activeSites: moviepilot?.activeSites ?? [],
          activeInclude: moviepilot?.activeInclude ?? '',
          activeExclude: moviepilot?.activeExclude ?? '',
        }}
        validationSchema={MoviePilotSettingsSchema}
        onSubmit={async (values) => {
          try {
            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              isDefault: values.isDefault,
              externalUrl: values.externalUrl,
              syncEnabled: values.syncEnabled,
              activeQuality: values.activeQuality || undefined,
              activeResolution: values.activeResolution || undefined,
              activeEffect: values.activeEffect || undefined,
              activeDownloader: values.activeDownloader || undefined,
              activeSavePath: values.activeSavePath || undefined,
              activeSites: values.activeSites,
              activeInclude: values.activeInclude || undefined,
              activeExclude: values.activeExclude || undefined,
            };
            if (!moviepilot) {
              await axios.post('/api/v1/settings/moviepilot', submission);
            } else {
              await axios.put(
                `/api/v1/settings/moviepilot/${moviepilot.id}`,
                submission
              );
            }

            onSave();
          } catch {
            // set error here
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
        }) => {
          const siteOptions = (lookupData?.sites ?? []).map((site) => ({
            value: site.id,
            label: `${site.name}${site.domain ? ` (${site.domain})` : ''}`,
          }));

          return (
            <Modal
              onCancel={onClose}
              okButtonType="primary"
              okText={
                isSubmitting
                  ? intl.formatMessage(globalMessages.saving)
                  : moviepilot
                    ? intl.formatMessage(globalMessages.save)
                    : intl.formatMessage(messages.add)
              }
              secondaryButtonType="warning"
              secondaryText={
                isTesting
                  ? intl.formatMessage(globalMessages.testing)
                  : intl.formatMessage(globalMessages.test)
              }
              onSecondary={() => {
                if (values.apiKey && values.hostname && values.port) {
                  testConnection({
                    apiKey: values.apiKey,
                    baseUrl: values.baseUrl,
                    hostname: values.hostname,
                    port: values.port,
                    useSsl: values.ssl,
                  });
                }
              }}
              secondaryDisabled={
                !values.apiKey ||
                !values.hostname ||
                !values.port ||
                isTesting ||
                isSubmitting
              }
              okDisabled={!isValidated || isSubmitting || isTesting || !isValid}
              onOk={() => handleSubmit()}
              title={
                !moviepilot
                  ? intl.formatMessage(messages.createmoviepilot)
                  : intl.formatMessage(messages.editmoviepilot)
              }
            >
              <div className="mb-6">
                <div className="form-row">
                  <label htmlFor="isDefault" className="checkbox-label">
                    {intl.formatMessage(messages.defaultserver)}
                  </label>
                  <div className="form-input-area">
                    <Field type="checkbox" id="isDefault" name="isDefault" />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="name" className="text-label">
                    {intl.formatMessage(messages.servername)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="name"
                        name="name"
                        type="text"
                        autoComplete="off"
                        data-form-type="other"
                        data-1pignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('name', e.target.value);
                        }}
                      />
                    </div>
                    {errors.name &&
                      touched.name &&
                      typeof errors.name === 'string' && (
                        <div className="error">{errors.name}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="hostname" className="text-label">
                    {intl.formatMessage(messages.hostname)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <span className="protocol">
                        {values.ssl ? 'https://' : 'http://'}
                      </span>
                      <Field
                        id="hostname"
                        name="hostname"
                        type="text"
                        inputMode="url"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          let value = e.target.value;
                          const protocolMatch = value.match(/^(https?):\/\//i);
                          if (protocolMatch) {
                            setFieldValue(
                              'ssl',
                              protocolMatch[1].toLowerCase() === 'https'
                            );
                            value = value.replace(/^(https?):\/\//i, '');
                          }
                          setFieldValue('hostname', value);
                        }}
                        className="rounded-r-only"
                      />
                    </div>
                    {errors.hostname &&
                      touched.hostname &&
                      typeof errors.hostname === 'string' && (
                        <div className="error">{errors.hostname}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="port" className="text-label">
                    {intl.formatMessage(messages.port)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      id="port"
                      name="port"
                      type="text"
                      inputMode="numeric"
                      className="short"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('port', e.target.value);
                      }}
                    />
                    {errors.port &&
                      touched.port &&
                      typeof errors.port === 'string' && (
                        <div className="error">{errors.port}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="ssl" className="checkbox-label">
                    {intl.formatMessage(messages.ssl)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="ssl"
                      name="ssl"
                      onChange={() => {
                        setIsValidated(false);
                        setFieldValue('ssl', !values.ssl);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="apiKey" className="text-label">
                    {intl.formatMessage(messages.apiKey)}
                    <span className="label-required">*</span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.apiKeyHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <SensitiveInput
                        as="field"
                        id="apiKey"
                        name="apiKey"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('apiKey', e.target.value);
                        }}
                      />
                    </div>
                    {errors.apiKey &&
                      touched.apiKey &&
                      typeof errors.apiKey === 'string' && (
                        <div className="error">{errors.apiKey}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="baseUrl" className="text-label">
                    {intl.formatMessage(messages.baseUrl)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.baseUrlHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="baseUrl"
                        name="baseUrl"
                        type="text"
                        inputMode="url"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('baseUrl', e.target.value);
                        }}
                      />
                    </div>
                    {errors.baseUrl &&
                      touched.baseUrl &&
                      typeof errors.baseUrl === 'string' && (
                        <div className="error">{errors.baseUrl}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="externalUrl" className="text-label">
                    {intl.formatMessage(messages.externalUrl)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.externalUrlHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="externalUrl"
                        name="externalUrl"
                        type="text"
                        inputMode="url"
                      />
                    </div>
                    {errors.externalUrl &&
                      touched.externalUrl &&
                      typeof errors.externalUrl === 'string' && (
                        <div className="error">{errors.externalUrl}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="syncEnabled" className="checkbox-label">
                    {intl.formatMessage(messages.syncEnabled)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.syncEnabledHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="syncEnabled"
                      name="syncEnabled"
                    />
                  </div>
                </div>
                <div className="mb-3 mt-6 border-t border-gray-700 pt-4">
                  <div className="text-lg font-semibold text-white">
                    {intl.formatMessage(messages.requestConfigTitle)}
                  </div>
                  <p className="description">
                    {intl.formatMessage(messages.requestConfigDescription)}
                  </p>
                </div>
                {!isValidated && (
                  <p className="mb-4 text-sm text-gray-400">
                    {intl.formatMessage(globalMessages.test)}
                  </p>
                )}
                <div className="form-row">
                  <label htmlFor="activeQuality" className="text-label">
                    {intl.formatMessage(messages.quality)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.qualityHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="activeQuality"
                        name="activeQuality"
                        type="text"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setFieldValue('activeQuality', e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeResolution" className="text-label">
                    {intl.formatMessage(messages.resolution)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.resolutionHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="activeResolution"
                        name="activeResolution"
                        type="text"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setFieldValue('activeResolution', e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeEffect" className="text-label">
                    {intl.formatMessage(messages.effect)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.effectHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="activeEffect"
                        name="activeEffect"
                        type="text"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setFieldValue('activeEffect', e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeDownloader" className="text-label">
                    {intl.formatMessage(messages.downloader)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.downloaderHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="activeDownloader"
                        name="activeDownloader"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          setFieldValue('activeDownloader', e.target.value);
                        }}
                      >
                        <option value="">{''}</option>
                        {(lookupData?.downloaders ?? []).map((client) => (
                          <option key={client.name} value={client.name}>
                            {client.name}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeSavePath" className="text-label">
                    {intl.formatMessage(messages.savePath)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.savePathHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="activeSavePath"
                        name="activeSavePath"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          setFieldValue('activeSavePath', e.target.value);
                        }}
                      >
                        <option value="">{''}</option>
                        {(lookupData?.paths ?? []).map((path) => (
                          <option key={path.save_path} value={path.save_path}>
                            {`${path.name ?? ''} (${path.save_path})`}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeSites" className="text-label">
                    {intl.formatMessage(messages.sites)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.sitesHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Select<{ value: number; label: string }, true>
                      name="activeSites"
                      isMulti
                      isDisabled={!isValidated}
                      options={siteOptions}
                      className="react-select-container react-select-container-dark"
                      classNamePrefix="react-select"
                      value={siteOptions.filter((option) =>
                        values.activeSites.includes(option.value)
                      )}
                      onChange={(value) => {
                        setFieldValue(
                          'activeSites',
                          (value ?? []).map((option) => option.value)
                        );
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeInclude" className="text-label">
                    {intl.formatMessage(messages.include)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.includeHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="activeInclude"
                        name="activeInclude"
                        type="text"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setFieldValue('activeInclude', e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="activeExclude" className="text-label">
                    {intl.formatMessage(messages.exclude)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.excludeHelp)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="activeExclude"
                        name="activeExclude"
                        type="text"
                        disabled={!isValidated}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setFieldValue('activeExclude', e.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );
};

export default MoviePilotModal;
