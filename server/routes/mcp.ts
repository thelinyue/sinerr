import { createMcpServer } from '@server/lib/mcp';
import { getSettings } from '@server/lib/settings';
import { Router } from 'express';

const mcpRoutes = Router();

/**
 * MCP Streamable HTTP 端点（Sinerr 2.0 模块 9）
 *
 * GET/POST /api/v1/mcp：Bearer 令牌鉴权，启用开关 mcpEnabled。
 * 令牌与「应用程序密钥」（settings.main.apiKey）共用，无需单独配置。
 * 无状态模式：每次请求创建 transport + McpServer。
 */

function authorized(req: { headers: { authorization?: string } }): boolean {
  const settings = getSettings();
  if (!settings.main.mcpEnabled || !settings.main.apiKey) {
    return false;
  }
  const auth = req.headers.authorization ?? '';
  return auth === `Bearer ${settings.main.apiKey}`;
}

mcpRoutes.all('/', async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const mcpServer = await createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await (mcpServer as { connect: (t: unknown) => Promise<void> }).connect(
      transport
    );
    await transport.handleRequest(req, res, req.body);
  } catch {
    // 连接已由 transport 接管；此处兜底
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  }
});

export default mcpRoutes;
