import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import NotificationTypeSelector from '@app/components/NotificationTypeSelector';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownOnSquareIcon, BeakerIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { Field, Form, Formik } from 'formik';
import { useState } from 'react';
import type { MessageDescriptor } from 'react-intl';
import { useIntl } from 'react-intl';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages(
  'components.Settings.Notifications.NotificationsWecom',
  {
    agentenabled: 'Enable Agent',
    corpid: '企业 ID (corpid)',
    corpsecret: '应用密钥 (corpsecret)',
    agentid: '应用 ID (agentid)',
    touser: '接收人 (touser)',
    touserTip: '成员 UserID，多个用逗号分隔',
    settingssaved: '企业微信通知设置已保存！',
    settingsfailed: '企业微信通知设置保存失败。',
    toastTestSending: '发送企业微信测试通知…',
    toastTestSuccess: '企业微信测试通知已发送！',
    toastTestFailed: '企业微信测试通知发送失败。',
    validationTypes: 'You must select at least one notification type',
  }
);

const NotificationsWecom = () => {
  const intl = useIntl();
  const { addToast, removeToast } = useToasts();
  const [isTesting, setIsTesting] = useState(false);
  const {
    data,
    error,
    mutate: revalidate,
  } = useSWR('/api/v1/settings/notifications/wecom');

  const NotificationsWecomSchema = Yup.object().shape({});

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  return (
    <Formik
      initialValues={{
        enabled: data.enabled,
        types: data.types,
        corpid: data.options.corpid,
        corpsecret: data.options.corpsecret,
        agentid: data.options.agentid,
        touser: data.options.touser,
      }}
      validationSchema={NotificationsWecomSchema}
      onSubmit={async (values) => {
        try {
          await axios.post('/api/v1/settings/notifications/wecom', {
            enabled: values.enabled,
            embedPoster: false,
            types: values.types,
            options: {
              corpid: values.corpid,
              corpsecret: values.corpsecret,
              agentid: values.agentid,
              touser: values.touser,
            },
          });
          addToast(intl.formatMessage(messages.settingssaved), {
            appearance: 'success',
            autoDismiss: true,
          });
        } catch {
          addToast(intl.formatMessage(messages.settingsfailed), {
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
              intl.formatMessage(messages.toastTestSending),
              { autoDismiss: false, appearance: 'info' },
              (id) => {
                toastId = id;
              }
            );
            await axios.post('/api/v1/settings/notifications/wecom/test', {
              enabled: true,
              embedPoster: false,
              types: values.types,
              options: {
                corpid: values.corpid,
                corpsecret: values.corpsecret,
                agentid: values.agentid,
                touser: values.touser,
              },
            });
            if (toastId) removeToast(toastId);
            addToast(intl.formatMessage(messages.toastTestSuccess), {
              autoDismiss: true,
              appearance: 'success',
            });
          } catch {
            if (toastId) removeToast(toastId);
            addToast(intl.formatMessage(messages.toastTestFailed), {
              autoDismiss: true,
              appearance: 'error',
            });
          } finally {
            setIsTesting(false);
          }
        };

        return (
          <Form className="section">
            <div className="form-row">
              <label htmlFor="enabled" className="checkbox-label">
                {intl.formatMessage(messages.agentenabled)}
              </label>
              <div className="form-input-area">
                <Field type="checkbox" id="enabled" name="enabled" />
              </div>
            </div>
            {(
              [
                ['corpid', messages.corpid],
                ['corpsecret', messages.corpsecret],
                ['agentid', messages.agentid],
              ] as [string, MessageDescriptor][]
            ).map(([name, label]) => (
              <div className="form-row" key={name}>
                <label htmlFor={name} className="text-label">
                  {intl.formatMessage(label)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field id={name} name={name} type="text" />
                  </div>
                </div>
              </div>
            ))}
            <div className="form-row">
              <label htmlFor="touser" className="text-label">
                <span>{intl.formatMessage(messages.touser)}</span>
                <span className="label-tip">
                  {intl.formatMessage(messages.touserTip)}
                </span>
              </label>
              <div className="form-input-area">
                <div className="form-input-field">
                  <Field id="touser" name="touser" type="text" />
                </div>
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
                    disabled={isSubmitting || !isValid || isTesting}
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

export default NotificationsWecom;
