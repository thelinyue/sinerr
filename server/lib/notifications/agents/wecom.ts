/*
Copyright(C) 2026

企业微信应用消息通知渠道（Sinerr 2.0 模块 10）
*/
import type { NotificationAgentWecom } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import { Notification } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent } from './agent';

const API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

/** access_token 缓存：key = corpid:corpsecret */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** 测试用：清空 token 缓存 */
export const resetWecomTokenCache = (): void => {
  tokenCache.clear();
};

class WecomAgent
  extends BaseAgent<NotificationAgentWecom>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentWecom {
    if (this.settings) {
      return this.settings;
    }
    const settings = getSettings();
    return settings.notifications.agents.wecom;
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();
    return !!(
      settings.enabled &&
      settings.options.corpid &&
      settings.options.corpsecret &&
      settings.options.agentid
    );
  }

  /** 获取 access_token（缓存，过期自动刷新） */
  private async getAccessToken(
    corpid: string,
    corpsecret: string
  ): Promise<string> {
    const cacheKey = `${corpid}:${corpsecret}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const res = await axios.get<{
      access_token?: string;
      expires_in?: number;
      errmsg?: string;
    }>(`${API_BASE}/gettoken`, {
      params: { corpid, corpsecret },
      timeout: 10000,
    });

    if (!res.data.access_token) {
      throw new Error(`WeCom gettoken failed: ${res.data.errmsg ?? 'unknown'}`);
    }

    const expiresIn = (res.data.expires_in ?? 7200) - 300;
    tokenCache.set(cacheKey, {
      token: res.data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return res.data.access_token;
  }

  private async sendWeCom(
    corpid: string,
    corpsecret: string,
    agentid: string,
    touser: string,
    content: string
  ): Promise<void> {
    const token = await this.getAccessToken(corpid, corpsecret);
    const res = await axios.post<{ errcode: number; errmsg?: string }>(
      `${API_BASE}/message/send?access_token=${encodeURIComponent(token)}`,
      {
        touser,
        msgtype: 'text',
        agentid: Number(agentid),
        text: { content },
      },
      { timeout: 10000 }
    );
    if (res.data.errcode !== 0) {
      throw new Error(
        `WeCom message send failed: ${res.data.errmsg ?? res.data.errcode}`
      );
    }
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    try {
      const settings = this.getSettings();
      if (!this.shouldSend()) {
        return false;
      }

      const content = [
        `【Sinerr】${payload.subject}`,
        payload.message ? `\n${payload.message}` : '',
      ].join('');

      await this.sendWeCom(
        settings.options.corpid,
        settings.options.corpsecret,
        settings.options.agentid,
        settings.options.touser,
        content
      );

      return true;
    } catch (e) {
      logger.error('Failed to send WeCom notification', {
        label: 'Notifications',
        type: Notification[type],
        message: e.message,
      });
      return false;
    }
  }
}

export default WecomAgent;
