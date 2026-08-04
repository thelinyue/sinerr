import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import type { Express, NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

/**
 * 测试共享基建（Sinerr 2.0 横切）
 *
 * 各测试文件自建 createApp/loginAs 的重复逻辑收敛于此：
 * - createTestApp(routes)：最小 express + session + checkUser + 错误处理
 * - loginAs / loginWithPermissions：supertest agent 登录
 */

export function createTestApp(routes: Router, mountPath?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  if (mountPath) {
    app.use(mountPath, routes);
  } else {
    app.use(routes);
  }
  app.use(
    (
      err: { status?: number; message?: string },
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

/** 本地登录并返回带 session 的 agent */
export async function loginAs(
  app: Express,
  email: string,
  password = 'test1234'
): Promise<ReturnType<typeof request.agent>> {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    if (res.status !== 200) {
      throw new Error(`Test login failed for ${email}: ${res.status}`);
    }
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

/** 设置权限后登录（构造不同权限场景） */
export async function loginWithPermissions(
  app: Express,
  email: string,
  permissions: number
): Promise<ReturnType<typeof request.agent>> {
  const userRepo = getRepository(User);
  const user = await userRepo.findOneOrFail({ where: { email } });
  user.permissions = permissions;
  await userRepo.save(user);
  return loginAs(app, email);
}
