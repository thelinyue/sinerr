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
});

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
        await axios.post('/api/v1/settings/moviepilot/test', {
          hostname,
          apiKey,
          port: Number(port),
          baseUrl,
          useSsl,
        });

        setIsValidated(true);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastMoviePilotTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch {
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

  // 编辑已有服务器时，挂载即测试一次连接以确认可用（不弹提示）。
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
              </div>
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );
};

export default MoviePilotModal;
