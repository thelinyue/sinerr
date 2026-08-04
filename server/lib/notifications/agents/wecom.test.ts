import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import { Notification } from '@server/lib/notifications';
import WecomAgent, {
  resetWecomTokenCache,
} from '@server/lib/notifications/agents/wecom';
import { setupTestDb } from '@server/test/db';
import axios from 'axios';

setupTestDb();

const getMock = mock.method(axios, 'get', async () => ({
  data: { access_token: 'test-token', expires_in: 7200 },
})).mock;
const postMock = mock.method(axios, 'post', async () => ({
  data: { errcode: 0, errmsg: 'ok' },
})).mock;

beforeEach(() => {
  getMock.resetCalls();
  postMock.resetCalls();
  resetWecomTokenCache();
});

function wecomAgent(): WecomAgent {
  return new WecomAgent({
    enabled: true,
    embedPoster: false,
    types: Notification.REQUEST_VOTED,
    options: {
      corpid: 'corp-1',
      corpsecret: 'secret-1',
      agentid: '1000002',
      touser: 'user1,user2',
    },
  });
}

describe('WecomAgent (module 10)', () => {
  it('sends an app message with the WeCom API', async () => {
    const agent = wecomAgent();
    const ok = await agent.send(Notification.REQUEST_VOTED, {
      subject: 'Test Movie',
      message: '有人也想看',
      notifySystem: true,
      notifyAdmin: false,
    });

    assert.strictEqual(ok, true);
    assert.strictEqual(getMock.callCount(), 1);
    assert.strictEqual(postMock.callCount(), 1);
    const [url, body] = postMock.calls[0].arguments as [
      string,
      { touser: string; agentid: number; text: { content: string } },
    ];
    assert.ok(String(url).includes('/cgi-bin/message/send'));
    assert.strictEqual(body.touser, 'user1,user2');
    assert.strictEqual(body.agentid, 1000002);
    assert.ok(String(body.text.content).includes('Test Movie'));
  });

  it('reuses the cached access token for subsequent sends', async () => {
    const agent = wecomAgent();
    await agent.send(Notification.REQUEST_VOTED, {
      subject: 'A',
      notifySystem: true,
      notifyAdmin: false,
    });
    await agent.send(Notification.REQUEST_VOTED, {
      subject: 'B',
      notifySystem: true,
      notifyAdmin: false,
    });

    assert.strictEqual(getMock.callCount(), 1);
    assert.strictEqual(postMock.callCount(), 2);
  });

  it('returns false when the API reports an error', async () => {
    postMock.mockImplementation(async () => ({
      data: { errcode: 60020, errmsg: 'not allowed to send' },
    }));
    const agent = wecomAgent();
    const ok = await agent.send(Notification.REQUEST_VOTED, {
      subject: 'X',
      notifySystem: true,
      notifyAdmin: false,
    });
    assert.strictEqual(ok, false);
  });

  it('is disabled when required options are missing', () => {
    const agent = new WecomAgent({
      enabled: true,
      embedPoster: false,
      types: Notification.REQUEST_VOTED,
      options: { corpid: '', corpsecret: '', agentid: '', touser: '' },
    });
    assert.strictEqual(agent.shouldSend(), false);
  });
});
