import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import NotificationTypeSelector from '@app/components/NotificationTypeSelector';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon, BeakerIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages(
  'components.Settings.Notifications.NotificationsMediary',
  {
    agentenabled: 'Enable Agent',
    toastMediaryTestSending: 'Sending Mediary test notification…',
    toastMediaryTestSuccess: 'Mediary test notification sent!',
    toastMediaryTestFailed: 'Mediary test notification failed to send.',
    mediarysettingssaved: 'Mediary notification settings saved successfully!',
    mediarysettingsfailed: 'Mediary notification settings failed to save.',
    validationTypes: 'You must select at least one notification type',
    noMediaryServer:
      'No default Mediary server is configured. Configure one in Settings → Services first.',
    description: 'Forward Sinerr notifications to your Mediary server.',
  }
);

const NotificationsMediary = () => {
  const intl = useIntl();
  const { addToast, removeToast } = useToasts();
  const [isTesting, setIsTesting] = useState(false);
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR('/api/v1/settings/notifications/mediary');

  const { data: mediaryData } = useSWR('/api/v1/settings/mediary');

  const hasDefaultMediary = mediaryData?.some(
    (m: { isDefault: boolean }) => m.isDefault
  );

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <Formik
      initialValues={{
        enabled: data?.enabled,
        types: data?.types,
      }}
      onSubmit={async (values) => {
        try {
          await axios.post('/api/v1/settings/notifications/mediary', {
            enabled: values.enabled,
            types: values.types,
            options: {},
          });
          addToast(intl.formatMessage(messages.mediarysettingssaved), {
            appearance: 'success',
            autoDismiss: true,
          });
        } catch {
          addToast(intl.formatMessage(messages.mediarysettingsfailed), {
            appearance: 'error',
            autoDismiss: true,
          });
        } finally {
          revalidate();
        }
      }}
    >
      {({
        touched,
        isSubmitting,
        values,
        isValid,
        setFieldValue,
        setFieldTouched,
      }) => {
        const testSettings = async () => {
          setIsTesting(true);
          let toastId: string | undefined;
          try {
            addToast(
              intl.formatMessage(messages.toastMediaryTestSending),
              {
                autoDismiss: false,
                appearance: 'info',
              },
              (id) => {
                toastId = id;
              }
            );
            await axios.post('/api/v1/settings/notifications/mediary/test', {
              enabled: true,
              types: values.types,
              options: {},
            });

            if (toastId) {
              removeToast(toastId);
            }
            addToast(intl.formatMessage(messages.toastMediaryTestSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            if (toastId) {
              removeToast(toastId);
            }
            addToast(intl.formatMessage(messages.toastMediaryTestFailed), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            setIsTesting(false);
          }
        };

        return (
          <Form className="section">
            <p className="description mb-6">
              {intl.formatMessage(messages.description)}
            </p>
            {!hasDefaultMediary && (
              <Alert
                title={intl.formatMessage(messages.noMediaryServer)}
                type="warning"
              />
            )}
            <div className="form-row">
              <label htmlFor="enabled" className="checkbox-label">
                {intl.formatMessage(messages.agentenabled)}
                <span className="label-required">*</span>
              </label>
              <div className="form-input-area">
                <Field type="checkbox" id="enabled" name="enabled" />
              </div>
            </div>
            <NotificationTypeSelector
              currentTypes={values.enabled ? values.types : 0}
              onUpdate={(newTypes) => {
                setFieldValue('types', newTypes);
                setFieldTouched('types');

                if (newTypes) {
                  setFieldValue('enabled', true);
                }
              }}
              error={
                values.enabled && !values.types && touched.types
                  ? intl.formatMessage(messages.validationTypes)
                  : undefined
              }
            />
            <div className="actions">
              <div className="flex justify-end">
                <span className="ml-3 inline-flex rounded-md shadow-sm">
                  <Button
                    buttonType="warning"
                    disabled={isSubmitting || !isValid || isTesting}
                    onClick={(e) => {
                      e.preventDefault();
                      testSettings();
                    }}
                  >
                    <BeakerIcon />
                    <span>
                      {isTesting
                        ? intl.formatMessage(globalMessages.testing)
                        : intl.formatMessage(globalMessages.test)}
                    </span>
                  </Button>
                </span>
                <span className="ml-3 inline-flex rounded-md shadow-sm">
                  <Button
                    buttonType="primary"
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !isValid ||
                      isTesting ||
                      (values.enabled && !values.types)
                    }
                  >
                    <ArrowDownOnSquareIcon />
                    <span>
                      {isSubmitting
                        ? intl.formatMessage(globalMessages.saving)
                        : intl.formatMessage(globalMessages.save)}
                    </span>
                  </Button>
                </span>
              </div>
            </div>
          </Form>
        );
      }}
    </Formik>
  );
};

export default NotificationsMediary;
