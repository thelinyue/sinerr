import JellyfinAPI from '@server/api/jellyfin';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Issue from '@server/entity/Issue';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaReview from '@server/entity/MediaReview';
import PlaybackEvent from '@server/entity/PlaybackEvent';
import RequestVote from '@server/entity/RequestVote';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import type { PlaybackProgressResponse } from '@server/interfaces/api/playbackInterfaces';
import type {
  Achievement,
  ActivityItem,
  QuotaResponse,
  RecentlyWatchedResponse,
  ReportMonth,
  UserAchievementsResponse,
  UserActivityResponse,
  UserReportResponse,
  UserRequestsResponse,
  UserResultsResponse,
  UserWatchTimeResponse,
  UserWatchedResponse,
  WatchedItem,
} from '@server/interfaces/api/userInterfaces';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getRecentlyAdded } from '@server/lib/recentlyAdded';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { DEFAULT_AVATAR_URL } from '@server/routes/avatarproxy';
import { appDataPath } from '@server/utils/appDataVolume';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { Router } from 'express';
import { promises as fs } from 'fs';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { join } from 'path';

import type { EntityManager } from 'typeorm';
import { In, Not } from 'typeorm';
import userSettingsRoutes from './usersettings';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const includeIds = [
      ...new Set(
        req.query.includeIds ? req.query.includeIds.toString().split(',') : []
      ),
    ];
    const pageSize = req.query.take
      ? Number(req.query.take)
      : Math.max(10, includeIds.length);
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const q = req.query.q ? req.query.q.toString().toLowerCase() : '';
    const sortParam = req.query.sort ? req.query.sort.toString() : undefined;
    const sortDirectionQuery = req.query.sortDirection
      ? req.query.sortDirection.toString().toLowerCase()
      : undefined;

    let sortDirection: 'ASC' | 'DESC';
    if (sortDirectionQuery === 'asc') {
      sortDirection = 'ASC';
    } else if (sortDirectionQuery === 'desc') {
      sortDirection = 'DESC';
    } else {
      switch (sortParam) {
        case 'displayname':
          sortDirection = 'ASC';
          break;
        case 'requests':
        case 'updated':
          sortDirection = 'DESC';
          break;
        case 'created':
        case 'usertype':
        case 'role':
        case undefined:
        default:
          sortDirection = 'ASC';
          break;
      }
    }

    let query = getRepository(User)
      .createQueryBuilder('user')
      .loadRelationCountAndMap('user.requestCount', 'user.requests');

    if (q) {
      query = query.where(
        'LOWER(user.username) LIKE :q OR LOWER(user.email) LIKE :q OR LOWER(user.jellyfinUsername) LIKE :q',
        { q: `%${q}%` }
      );
    }

    if (includeIds.length > 0) {
      query.andWhereInIds(includeIds);
    }

    switch (sortParam) {
      case 'created':
        query = query.orderBy('user.createdAt', sortDirection);
        break;
      case 'updated':
        query = query.orderBy('user.updatedAt', sortDirection);
        break;
      case 'displayname':
        query = query
          .addSelect(
            `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
                CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                  COALESCE("user"."email", '')
                ELSE
                  LOWER(user.jellyfinUsername)
                END)
              ELSE
                LOWER(user.username)
              END`,
            'displayname_sort_key'
          )
          .orderBy('displayname_sort_key', sortDirection);
        break;
      case 'requests':
        query = query
          .addSelect((subQuery) => {
            return subQuery
              .select('COUNT(request.id)', 'request_count')
              .from(MediaRequest, 'request')
              .where('request.requestedBy.id = user.id');
          }, 'request_count')
          .orderBy('request_count', sortDirection);
        break;
      case 'usertype':
        query = query.orderBy('user.userType', sortDirection);
        break;
      case 'role':
        query = query
          .addSelect(
            `CASE
              WHEN user.id = 1 THEN 0
              WHEN (user.permissions & ${Permission.ADMIN}) != 0 THEN 1
              ELSE 2
            END`,
            'role_sort_key'
          )
          .orderBy('role_sort_key', sortDirection);
        break;
      default:
        query = query.orderBy('user.id', sortDirection);
        break;
    }

    const [users, userCount] = await query
      .take(pageSize)
      .skip(skip)
      .distinct(true)
      .getManyAndCount();

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(userCount / pageSize),
        pageSize,
        results: userCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: User.filterMany(
        users,
        req.user?.hasPermission(Permission.MANAGE_USERS)
      ),
    } as UserResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.post(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();

      const body = req.body;
      const username = body.username;
      const userRepository = getRepository(User);

      if (!username) {
        return next({
          status: 400,
          message: 'Username is required.',
        });
      }

      const existingUser = await userRepository
        .createQueryBuilder('user')
        .where('user.username = :username', {
          username,
        })
        .getOne();

      if (existingUser) {
        return next({
          status: 409,
          message: 'User already exists with submitted username.',
          errors: ['USER_EXISTS'],
        });
      }

      const passedExplicitPassword = body.password && body.password.length > 0;
      const createEmby =
        body.createEmbyAccount &&
        (settings.main.mediaServerType === MediaServerType.JELLYFIN ||
          settings.main.mediaServerType === MediaServerType.EMBY);
      const avatar = body.avatar ?? DEFAULT_AVATAR_URL;

      const user = new User({
        email: body.email || null,
        avatar,
        username,
        password: body.password,
        permissions: settings.main.defaultPermissions,
        userType: UserType.LOCAL,
      });

      let generatedPassword: string | undefined;
      let embyPassword: string | undefined;

      if (passedExplicitPassword) {
        await user.setPassword(body.password);
        embyPassword = body.password;
      } else if (createEmby) {
        generatedPassword = nanoid(16);
        embyPassword = generatedPassword;
        await user.setPassword(generatedPassword);
      } else {
        generatedPassword = nanoid(16);
        await user.setPassword(generatedPassword);
      }

      await userRepository.save(user);

      if (createEmby) {
        try {
          const hostname = getHostname();
          const deviceId = Buffer.from(`BOT_sinerr_${username ?? ''}`).toString(
            'base64'
          );

          const jellyfinClient = new JellyfinAPI(
            hostname ?? '',
            settings.jellyfin.apiKey,
            deviceId,
            settings.main.mediaServerType
          );

          const account = await jellyfinClient.createUser({
            Name: username,
            Password: embyPassword ?? nanoid(16),
          });

          // 模块 8：POST /Users/New 忽略 Password，必须显式设置密码，否则无法登录
          await jellyfinClient.updateUserPassword(
            account.Id,
            embyPassword ?? nanoid(16)
          );

          user.jellyfinUserId = account.Id;
          user.jellyfinUsername = account.Name;
          user.jellyfinDeviceId = deviceId;
          user.avatar = DEFAULT_AVATAR_URL;
          user.userType =
            settings.main.mediaServerType === MediaServerType.JELLYFIN
              ? UserType.JELLYFIN
              : UserType.EMBY;

          if (settings.jellyfin.jellyfinTemplateUserId) {
            try {
              const templateUser = await jellyfinClient.getUserById(
                settings.jellyfin.jellyfinTemplateUserId
              );
              const policy = templateUser.Policy;
              delete (policy as unknown as Record<string, unknown>)
                .IsAdministrator;

              await jellyfinClient.updateUserPolicy(account.Id, policy);
              logger.info(
                'Applied template user policy to new Emby/Jellyfin user',
                {
                  label: 'User Management',
                  username,
                  templateUserId: settings.jellyfin.jellyfinTemplateUserId,
                }
              );
            } catch (e) {
              logger.warn('Failed to apply template user policy', {
                label: 'User Management',
                error: e.message,
              });
            }
          }

          await userRepository.save(user);
          logger.info('Created matching Emby/Jellyfin account for local user', {
            label: 'User Management',
            username,
            jellyfinUserId: account.Id,
          });
        } catch (e) {
          logger.error(
            'Failed to create Emby/Jellyfin account for local user',
            {
              label: 'User Management',
              username,
              error: e.message,
            }
          );
        }
      }

      const response = user.filter() as Record<string, unknown>;
      if (generatedPassword) {
        response.generatedPassword = generatedPassword;
      }
      return res.status(201).json(response);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post<
  never,
  unknown,
  {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string;
  }
>('/registerPushSubscription', async (req, res, next) => {
  try {
    // This prevents race conditions where two requests both pass the checks
    await dataSource.transaction(
      async (transactionalEntityManager: EntityManager) => {
        const transactionalRepo =
          transactionalEntityManager.getRepository(UserPushSubscription);

        // Check for existing subscription by auth or endpoint within transaction
        const existingSubscription = await transactionalRepo.findOne({
          relations: { user: true },
          where: [
            { auth: req.body.auth, user: { id: req.user?.id } },
            { endpoint: req.body.endpoint, user: { id: req.user?.id } },
          ],
        });

        if (existingSubscription) {
          // If endpoint matches but auth is different, update with new keys (iOS refresh case)
          if (
            existingSubscription.endpoint === req.body.endpoint &&
            existingSubscription.auth !== req.body.auth
          ) {
            existingSubscription.auth = req.body.auth;
            existingSubscription.p256dh = req.body.p256dh;
            existingSubscription.userAgent = req.body.userAgent;

            await transactionalRepo.save(existingSubscription);

            logger.debug(
              'Updated existing push subscription with new keys for same endpoint.',
              { label: 'API' }
            );
            return;
          }

          logger.debug(
            'Duplicate subscription detected. Skipping registration.',
            { label: 'API' }
          );
          return;
        }

        // Clean up old subscriptions from the same device (userAgent) for this user
        // iOS can silently refresh endpoints, leaving stale subscriptions in the database
        // Only clean up if we're creating a new subscription (not updating an existing one)
        if (req.body.userAgent) {
          const staleSubscriptions = await transactionalRepo.find({
            relations: { user: true },
            where: {
              userAgent: req.body.userAgent,
              user: { id: req.user?.id },
              // Only remove subscriptions with different endpoints (stale ones)
              // Keep subscriptions that might be from different browsers/tabs
              endpoint: Not(req.body.endpoint),
            },
          });

          if (staleSubscriptions.length > 0) {
            await transactionalRepo.remove(staleSubscriptions);
            logger.debug(
              `Removed ${staleSubscriptions.length} stale push subscription(s) from same device.`,
              { label: 'API' }
            );
          }
        }

        const userPushSubscription = new UserPushSubscription({
          auth: req.body.auth,
          endpoint: req.body.endpoint,
          p256dh: req.body.p256dh,
          userAgent: req.body.userAgent,
          user: req.user,
        });

        await transactionalRepo.save(userPushSubscription);
      }
    );

    return res.status(204).send();
  } catch {
    logger.error('Failed to register user push subscription', {
      label: 'API',
    });
    next({ status: 500, message: 'Failed to register subscription.' });
  }
});

router.get<{ id: string }>(
  '/:id/pushSubscriptions',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSubs = await userPushSubRepository.find({
        relations: { user: true },
        where: { user: { id: Number(req.params.id) } },
      });

      return res.status(200).json(userPushSubs);
    } catch {
      next({ status: 404, message: 'User subscriptions not found.' });
    }
  }
);

router.get<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOneOrFail({
        relations: {
          user: true,
        },
        where: {
          user: { id: Number(req.params.id) },
          endpoint: req.params.endpoint,
        },
      });

      return res.status(200).json(userPushSub);
    } catch {
      next({ status: 404, message: 'User subscription not found.' });
    }
  }
);

router.delete<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOne({
        relations: { user: true },
        where: {
          user: { id: Number(req.params.id) },
          endpoint: req.params.endpoint,
        },
      });

      // If not found, just return 204 to prevent push disable failure
      // (rare scenario where user push sub does not exist)
      if (!userPushSub) {
        return res.status(204).send();
      }

      await userPushSubRepository.remove(userPushSub);
      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong deleting the user push subcription', {
        label: 'API',
        endpoint: req.params.endpoint,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'User push subcription not found',
      });
    }
  }
);

router.get<{ id: string }>('/:id', async (req, res, next) => {
  try {
    const userRepository = getRepository(User);
    const user = await userRepository.findOneOrFail({
      where: { id: Number(req.params.id) },
    });

    user.requestCount = await getRepository(MediaRequest).count({
      where: { requestedBy: { id: user.id } },
    });

    const isOwnProfile = req.user?.id === user.id;
    const isAdmin = req.user?.hasPermission(Permission.MANAGE_USERS);

    return res.status(200).json(user.filter(isOwnProfile || isAdmin));
  } catch {
    next({ status: 404, message: 'User not found.' });
  }
});

router.get<{ jellyfinUserId: string }>(
  '/jellyfin/:jellyfinUserId',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const jellyfinUserId = normalizeJellyfinGuid(req.params.jellyfinUserId);
      if (!jellyfinUserId) {
        return next({ status: 400, message: 'Invalid Jellyfin User ID.' });
      }

      const user = await userRepository.findOneOrFail({
        where: { jellyfinUserId },
      });

      user.requestCount = await getRepository(MediaRequest).count({
        where: { requestedBy: { id: user.id } },
      });

      return res
        .status(200)
        .json(user.filter(req.user?.hasPermission(Permission.MANAGE_USERS)));
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.use('/:id/settings', userSettingsRoutes);

router.get<{ id: string }, UserRequestsResponse>(
  '/:id/requests',
  async (req, res, next) => {
    const pageSize = req.query.take ? Number(req.query.take) : 20;
    const skip = req.query.skip ? Number(req.query.skip) : 0;

    try {
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        user.id !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: "You do not have permission to view this user's requests.",
        });
      }

      const [requests, requestCount] = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.seasons', 'seasons')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .andWhere('requestedBy.id = :id', {
          id: user.id,
        })
        .orderBy('request.id', 'DESC')
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: requests,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export const canMakePermissionsChange = (
  permissions: number,
  user?: User
): boolean =>
  // Only let the owner grant admin privileges
  !(hasPermission(Permission.ADMIN, permissions) && user?.id !== 1);

router.put<
  Record<string, never>,
  Partial<User>[],
  { ids: string[]; permissions: number }
>('/', isAuthenticated(Permission.MANAGE_USERS), async (req, res, next) => {
  try {
    const isOwner = req.user?.id === 1;

    if (!canMakePermissionsChange(req.body.permissions, req.user)) {
      return next({
        status: 403,
        message: 'You do not have permission to grant this level of access',
      });
    }

    const userRepository = getRepository(User);

    const users: User[] = await userRepository.find({
      where: {
        id: In(
          isOwner ? req.body.ids : req.body.ids.filter((id) => Number(id) !== 1)
        ),
      },
    });

    const updatedUsers = await Promise.all(
      users.map(async (user) => {
        return userRepository.save(<User>{
          ...user,
          ...{ permissions: req.body.permissions },
        });
      })
    );

    return res.status(200).json(updatedUsers);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Only let the owner user modify themselves
      if (user.id === 1 && req.user?.id !== 1) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }

      if (!canMakePermissionsChange(req.body.permissions, req.user)) {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }

      Object.assign(user, {
        username: req.body.username,
        nickname: req.body.nickname?.trim() || null,
        permissions: req.body.permissions,
      });

      await userRepository.save(user);

      return res.status(200).json(user.filter());
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
        relations: { requests: true },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (user.id === 1) {
        return next({
          status: 405,
          message: 'This account cannot be deleted.',
        });
      }

      if (user.hasPermission(Permission.ADMIN) && req.user?.id !== 1) {
        return next({
          status: 405,
          message: 'You cannot delete users with administrative privileges.',
        });
      }

      const requestRepository = getRepository(MediaRequest);

      /**
       * Requests are usually deleted through a cascade constraint. Those however, do
       * not trigger the removal event so listeners to not run and the parent Media
       * will not be updated back to unknown for titles that were still pending. So
       * we manually remove all requests from the user here so the parent media's
       * properly reflect the change.
       */
      await requestRepository.remove(user.requests, {
        /**
         * Break-up into groups of 1000 requests to be removed at a time.
         * Necessary for users with >1000 requests, else an SQLite 'Expression tree is too large' error occurs.
         * https://typeorm.io/repository-api#additional-options
         */
        chunk: user.requests.length / 1000,
      });

      await userRepository.delete(user.id);
      return res.status(200).json(user.filter());
    } catch (e) {
      logger.error('Something went wrong deleting a user', {
        label: 'API',
        userId: req.params.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Something went wrong deleting the user',
      });
    }
  }
);

router.post(
  '/import-from-jellyfin',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    logger.info('IMPORT HANDLER ENTERED', { label: 'Debug' });
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { jellyfinUserIds: string[] };

      // taken from auth.ts
      const admin = await userRepository.findOneOrFail({
        where: { id: req.user?.id ?? 1 },
        select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
        order: { id: 'ASC' },
      });

      const hostname = getHostname();
      logger.info('Importing Jellyfin users - connecting to Emby/Jellyfin', {
        label: 'User Import',
        hostname,
        apiKeyLength: settings.jellyfin.apiKey?.length ?? 0,
        deviceId: admin.jellyfinDeviceId?.substring(0, 12) ?? '(none)',
      });
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId ?? '',
        settings.main.mediaServerType
      );

      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

      logger.debug('Calling Emby/Jellyfin getUsers() API', {
        label: 'User Import',
      });
      const jellyfinUsers = await jellyfinClient.getUsers();
      logger.debug('Emby/Jellyfin getUsers() returned, processing users', {
        label: 'User Import',
        userCount: jellyfinUsers?.users?.length ?? 0,
      });

      const jellyfinUsersById = new Map(
        jellyfinUsers.users.map((user) => [
          normalizeJellyfinGuid(user.Id),
          user,
        ])
      );

      const normalizedIds = body.jellyfinUserIds
        .map((id) => normalizeJellyfinGuid(id))
        .filter((id): id is string => !!id);

      const existingUsers = await userRepository.find({
        select: ['id', 'jellyfinUserId'],
        where:
          normalizedIds.length > 0 ? { jellyfinUserId: In(normalizedIds) } : {},
      });
      const existingIds = new Set(existingUsers.map((u) => u.jellyfinUserId));

      const newUsers: User[] = [];

      for (const jellyfinUserId of normalizedIds) {
        if (existingIds.has(jellyfinUserId)) {
          continue;
        }

        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);

        newUsers.push(
          new User({
            jellyfinUsername: jellyfinUser?.Name,
            jellyfinUserId: jellyfinUserId,
            jellyfinDeviceId: Buffer.from(
              `BOT_sinerr_${jellyfinUser?.Name ?? ''}`
            ).toString('base64'),
            username: jellyfinUser?.Name,
            permissions: settings.main.defaultPermissions,
            avatar: DEFAULT_AVATAR_URL,
            userType:
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY,
          })
        );
      }

      if (newUsers.length > 0) {
        await userRepository.save(newUsers);
      }

      return res.status(201).json({ imported: newUsers.length });
    } catch (e) {
      logger.error('Failed to import Jellyfin users', {
        label: 'User Import',
        error: e.errorCode || e.message,
        status: e.statusCode || e.response?.status || e.status,
        hostname: getHostname(),
      });
      next({
        status: 500,
        message:
          e.errorCode ||
          e.message ||
          'Something went wrong importing Jellyfin users',
      });
    }
  }
);

router.get<{ id: string }, QuotaResponse>(
  '/:id/quota',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      if (
        Number(req.params.id) !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'and' }
        )
      ) {
        return next({
          status: 403,
          message:
            "You do not have permission to view this user's request limits.",
        });
      }

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      const quotas = await user.getQuota();

      return res.status(200).json(quotas);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

/**
 * 用户成就徽章接口
 *
 * 按需聚合计算（不落新表）：
 * - requester：请求数 >= 10 / 50 / 100
 * - voted：获得的点赞数 >= 5 / 25
 * - helper：解决的 Issue 数 >= 3
 *
 * 徽章仅展示给本人或具备查看权限的用户。
 */
router.get<{ id: string }, UserAchievementsResponse>(
  '/:id/achievements',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const requestRepository = getRepository(MediaRequest);
      const issueRepository = getRepository(Issue);

      const [requestCount, votesReceived, resolvedIssues] = await Promise.all([
        requestRepository.count({
          where: { requestedBy: { id: userId } },
        }),
        requestRepository
          .createQueryBuilder('request')
          .leftJoinAndSelect('request.requestedBy', 'requestedBy')
          .leftJoin('request.votes', 'vote')
          .where('requestedBy.id = :userId', { userId })
          .select('COUNT(vote.id)', 'count')
          .getRawOne<{ count: string }>(),
        issueRepository.count({
          where: { createdBy: { id: userId } },
        }),
      ]);

      const votesReceivedCount = Number(votesReceived?.count ?? 0);

      const definitions: {
        id: string;
        target: number;
        current: number;
      }[] = [
        { id: 'requester10', target: 10, current: requestCount },
        { id: 'requester50', target: 50, current: requestCount },
        { id: 'requester100', target: 100, current: requestCount },
        { id: 'voted5', target: 5, current: votesReceivedCount },
        { id: 'voted25', target: 25, current: votesReceivedCount },
        { id: 'helper3', target: 3, current: resolvedIssues },
      ];

      const results: Achievement[] = definitions.map((def) => ({
        id: def.id,
        target: def.target,
        current: def.current,
        earned: def.current >= def.target,
        progress: Math.min(100, Math.round((def.current / def.target) * 100)),
      }));

      return res.status(200).json({ results });
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

/**
 * 追更中（Sinerr 2.0 模块 4-F2）
 *
 * 返回我请求或声援过的剧的最新更新状态（复用 recentlyadded 聚合服务，限定 mediaIds）。
 * 可见范围：本人 + 管理员 + REQUEST_VIEW（与请求可见范围一致）。
 */
router.get<{ id: string }>(
  '/:id/following-updates',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const requestRepo = getRepository(MediaRequest);
      const voteRepo = getRepository(RequestVote);
      const [requests, votes] = await Promise.all([
        requestRepo.find({
          where: {
            requestedBy: { id: userId },
            status: Not(MediaRequestStatus.DECLINED),
          },
          relations: { media: true },
        }),
        voteRepo.find({
          where: { user: { id: userId } },
          relations: { request: { media: true } },
        }),
      ]);

      const mediaIds = [
        ...new Set(
          [
            ...requests.map((r) => r.media?.id),
            ...votes.map((v) => v.request?.media?.id),
          ].filter((id): id is number => !!id)
        ),
      ];

      if (mediaIds.length === 0) {
        return res.status(200).json({
          results: [],
          pageInfo: { pages: 0, pageSize: 0, results: 0, page: 0 },
        });
      }

      const days = req.query.days ? Number(req.query.days) : 7;
      const take = req.query.take ? Number(req.query.take) : 20;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const { results, total } = await getRecentlyAdded(since, take, skip, {
        mediaIds,
      });
      return res.status(200).json({
        results,
        pageInfo: {
          pages: Math.ceil(total / take),
          pageSize: take,
          results: total,
          page: Math.floor(skip / take) + 1,
        },
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

/**
 * 头像上传（Sinerr 2.0 模块 7）
 *
 * multipart 单文件 avatar，MIME 白名单（png/jpg/webp）≤ 2MB，
 * 存 `<appDataPath>/avatars/<userId>.<ext>`，更新 user.avatar。
 * 权限：本人或 MANAGE_USERS。
 */

const AVATAR_MIME_WHITELIST = ['image/png', 'image/jpeg', 'image/webp'];

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME_WHITELIST.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

async function removeUploadedAvatar(userId: number): Promise<void> {
  const dir = join(appDataPath(), 'avatars');
  const files = await fs.readdir(dir).catch(() => []);
  for (const file of files) {
    if (file.startsWith(`${userId}.`)) {
      await fs.unlink(join(dir, file)).catch(() => {});
    }
  }
}

router.post(
  '/:id/avatar',
  isAuthenticated(),
  avatarUpload.single('avatar'),
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);
      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission([Permission.MANAGE_USERS], { type: 'or' })
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to update this user.',
        });
      }
      if (!req.file) {
        return next({
          status: 400,
          message: 'No valid image file provided.',
        });
      }

      const ext =
        req.file.mimetype === 'image/png'
          ? 'png'
          : req.file.mimetype === 'image/webp'
            ? 'webp'
            : 'jpg';
      const dir = join(appDataPath(), 'avatars');
      await fs.mkdir(dir, { recursive: true });
      await removeUploadedAvatar(userId);
      await fs.writeFile(join(dir, `${userId}.${ext}`), req.file.buffer);

      const user = await getRepository(User).findOneOrFail({
        where: { id: userId },
      });
      user.avatar = `/avatarproxy/upload/${userId}`;
      await getRepository(User).save(user);

      return res.status(200).json({ avatar: user.avatar });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.delete('/:id/avatar', isAuthenticated(), async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (
      userId !== req.user?.id &&
      !req.user?.hasPermission([Permission.MANAGE_USERS], { type: 'or' })
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to update this user.',
      });
    }

    await removeUploadedAvatar(userId);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    user.avatar = user.jellyfinUserId
      ? `/avatarproxy/${user.jellyfinUserId}`
      : DEFAULT_AVATAR_URL;
    await getRepository(User).save(user);

    return res.status(200).json({ avatar: user.avatar });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

/**
 * 用户最近观看记录
 *
 * 数据源为本地 PlaybackEvent（webhook 写入，按 user+tmdbId 保存最新播放），
 * 按 createdAt 时间倒序返回。可见范围：本人或 MANAGE_USERS / MANAGE_REQUESTS。
 */
router.get<{ id: string }, RecentlyWatchedResponse>(
  '/:id/recently-watched',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const events = await getRepository(PlaybackEvent)
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.user', 'user')
        .where('user.id = :userId', { userId })
        .orderBy('event.createdAt', 'DESC')
        .take(100)
        .getMany();

      // 去重：剧集按 (tmdbId, 季, 集) 保留最近一次观看；电影按 tmdbId 保留最近一次
      const seen = new Set<string>();
      const deduped: PlaybackEvent[] = [];
      for (const event of events) {
        const key =
          event.mediaType === MediaType.TV
            ? `tv-${event.tmdbId}-${event.seasonNumber ?? ''}-${event.episodeNumber ?? ''}`
            : `movie-${event.tmdbId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(event);
      }

      return res.status(200).json({
        results: deduped.slice(0, 24).map((event) => ({
          tmdbId: event.tmdbId,
          mediaType: event.mediaType,
          completed: event.completed,
          durationSeconds: event.durationSeconds,
          seasonNumber: event.seasonNumber,
          episodeNumber: event.episodeNumber,
          createdAt: event.createdAt,
        })),
      });
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

/**
 * 播放时长统计接口
 *
 * 返回指定用户今日与累计的播放时长（秒），数据来自 PlaybackEvent.durationSeconds。
 *
 * 可见范围：本人或具备 MANAGE_USERS / MANAGE_REQUESTS 权限。
 */
router.get<{ id: string }, UserWatchTimeResponse>(
  '/:id/watchtime',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const targetUser = await getRepository(User).findOneOrFail({
        where: { id: userId },
      });

      // 优先从 Playback Report 插件读取（含历史数据）
      if (targetUser.jellyfinUserId) {
        const settings = getSettings();
        const hostname = getHostname();
        const jellyfinClient = new JellyfinAPI(
          hostname,
          settings.jellyfin.apiKey,
          'BOT_sinerr',
          settings.main.mediaServerType
        );
        const pluginWatchTime = await jellyfinClient.getUserWatchTime(
          targetUser.jellyfinUserId
        );
        // 插件返回 0 无法区分「没数据」还是「无插件」；若配置了插件但查询失败，
        // 方法内部已返回 0 并记日志。为兼容未装插件的部署，当总时长为 0 时
        // 回退到 webhook 的 PlaybackEvent 聚合。
        if (pluginWatchTime.totalSeconds > 0) {
          return res.status(200).json(pluginWatchTime);
        }
      }

      // 回退：从 webhook 写入的 PlaybackEvent 聚合
      const playbackRepository = getRepository(PlaybackEvent);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [todayRow, totalRow] = await Promise.all([
        playbackRepository
          .createQueryBuilder('event')
          .leftJoinAndSelect('event.user', 'user')
          .select('SUM(event.durationSeconds)', 'total')
          .where('user.id = :userId', { userId })
          .andWhere('event.createdAt >= :startOfToday', { startOfToday })
          .getRawOne<{ total: string | null }>(),
        playbackRepository
          .createQueryBuilder('event')
          .leftJoinAndSelect('event.user', 'user')
          .select('SUM(event.durationSeconds)', 'total')
          .where('user.id = :userId', { userId })
          .getRawOne<{ total: string | null }>(),
      ]);

      return res.status(200).json({
        todaySeconds: Number(todayRow?.total ?? 0),
        totalSeconds: Number(totalRow?.total ?? 0),
      });
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

/**
 * 播放进度接口
 *
 * 返回指定用户对某部媒体（电影/剧集）的观看状态，数据来自
 * Jellyfin/Emby 的 Playback Reporting 插件（PlaybackActivity 表）。
 *
 * - 电影：存在该电影的播放记录即视为已看，返回播放次数与累计时长。
 * - 剧集：遍历该剧所有季的所有集，统计该用户看过的集数，
 *   返回已看集数 / 总集数 / 百分比。
 *
 * 可见范围：本人或具备 MANAGE_USERS / MANAGE_REQUESTS 权限。
 */
router.get<
  { id: string; tmdbId: string; mediaType: string },
  PlaybackProgressResponse
>('/:id/media/:tmdbId/:mediaType/playback', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    if (
      userId !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
        { type: 'or' }
      )
    ) {
      return next({
        status: 403,
        message: 'You do not have permission to view this user.',
      });
    }

    const targetUser = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });

    // 需要 Jellyfin 用户 ID 才能查询播放记录
    if (!targetUser.jellyfinUserId) {
      return res.status(200).json({
        played: false,
        playCount: 0,
        playDurationSeconds: 0,
      });
    }

    const settings = getSettings();
    const mediaRepository = getRepository(Media);

    const media = await mediaRepository.findOne({
      where: {
        tmdbId: Number(req.params.tmdbId),
        mediaType: req.params.mediaType as Media['mediaType'],
      },
    });

    if (!media?.jellyfinMediaId) {
      return res.status(200).json({
        played: false,
        playCount: 0,
        playDurationSeconds: 0,
      });
    }

    const hostname = getHostname();
    const jellyfinClient = new JellyfinAPI(
      hostname,
      settings.jellyfin.apiKey,
      'BOT_sinerr',
      settings.main.mediaServerType
    );

    const isMovie = req.params.mediaType === 'movie';

    if (isMovie) {
      const [playback] = await jellyfinClient.getUserPlaybackActivity(
        targetUser.jellyfinUserId,
        'Movie',
        [media.jellyfinMediaId]
      );

      return res.status(200).json({
        played: !!playback && playback.PlayCount > 0,
        playCount: playback?.PlayCount ?? 0,
        playDurationSeconds: playback?.PlayDurationSeconds ?? 0,
      });
    }

    // 剧集：本地季集结构（Episode 表）替代「getSeasons + N 次 getEpisodes」遍历
    const seriesId = media.jellyfinMediaId;
    const episodeRepository = getRepository(Episode);
    const localEpisodes = await episodeRepository.find({
      where: { media: { id: media.id } },
    });

    // 按季分组：episodeIds（Jellyfin 单集 ID）+ 总集数
    const seasonsOfEpisodes = new Map<
      number,
      { episodeIds: string[]; total: number }
    >();
    for (const episode of localEpisodes) {
      if (!episode.jellyfinEpisodeId) {
        continue;
      }
      const season = seasonsOfEpisodes.get(episode.seasonNumber) ?? {
        episodeIds: [],
        total: 0,
      };
      season.episodeIds.push(episode.jellyfinEpisodeId);
      season.total += 1;
      seasonsOfEpisodes.set(episode.seasonNumber, season);
    }

    const seasonNumbers = [...seasonsOfEpisodes.keys()].sort((a, b) => a - b);

    if (seasonNumbers.length === 0) {
      return res.status(200).json({
        played: false,
        playCount: 0,
        playDurationSeconds: 0,
      });
    }

    // 优先插件聚合 API（一次查询、total 实时）；404 回退 Episode 表 + getUserPlaybackActivity
    const pluginProgress = await jellyfinClient.getSeriesProgress(
      targetUser.jellyfinUserId,
      seriesId
    );

    let seasons: {
      seasonNumber: number;
      watchedEpisodes: number;
      totalEpisodes: number;
    }[];
    let watchedSet: Set<string>;

    if (pluginProgress !== null) {
      seasons = seasonNumbers.map((seasonNumber) => {
        const pluginSeason = pluginProgress.find(
          (p) => p.seasonNumber === seasonNumber
        );
        return {
          seasonNumber,
          watchedEpisodes: pluginSeason?.watched ?? 0,
          totalEpisodes: seasonsOfEpisodes.get(seasonNumber)?.total ?? 0,
        };
      });
      watchedSet = new Set<string>();
      for (const season of seasons) {
        for (let i = 0; i < season.watchedEpisodes; i++) {
          watchedSet.add(`${season.seasonNumber}-${i}`);
        }
      }
    } else {
      const allEpisodeIds = seasonNumbers.flatMap(
        (sn) => seasonsOfEpisodes.get(sn)?.episodeIds ?? []
      );
      const watchedEpisodes = await jellyfinClient.getUserPlaybackActivity(
        targetUser.jellyfinUserId,
        'Episode',
        allEpisodeIds
      );
      watchedSet = new Set(watchedEpisodes.map((item) => item.ItemId));

      seasons = seasonNumbers.map((seasonNumber) => {
        const seasonData = seasonsOfEpisodes.get(seasonNumber);
        const watchedCount = (seasonData?.episodeIds ?? []).filter((id) =>
          watchedSet.has(id)
        ).length;
        return {
          seasonNumber,
          watchedEpisodes: watchedCount,
          totalEpisodes: seasonData?.total ?? 0,
        };
      });
    }

    const watchedCount = seasons.reduce(
      (sum, season) => sum + season.watchedEpisodes,
      0
    );
    const totalEpisodes = seasons.reduce(
      (sum, season) => sum + season.totalEpisodes,
      0
    );
    const watchedPercent = totalEpisodes
      ? Math.round((watchedCount / totalEpisodes) * 100)
      : 0;

    return res.status(200).json({
      played: watchedCount > 0,
      playCount: watchedCount,
      playDurationSeconds: 0,
      watchedEpisodes: watchedCount,
      totalEpisodes,
      watchedPercent,
      seasons,
    });
  } catch (e) {
    next({ status: 404, message: e.message });
  }
});

/**
 * 已看 grid：实时查询 Playback Reporting 插件（权威），再与本地
 * Media/Episode/MediaReview 映射补齐 tmdbId / 剧集进度 / 用户评分。
 *
 * 可见范围：本人或具备 MANAGE_USERS / MANAGE_REQUESTS 权限。
 */
router.get<{ id: string }, UserWatchedResponse>(
  '/:id/watched',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const targetUser = await getRepository(User).findOneOrFail({
        where: { id: userId },
      });

      if (!targetUser.jellyfinUserId) {
        return res.status(200).json({
          pageInfo: { pages: 0, pageSize: 0, results: 0, page: 0 },
          results: [],
        });
      }

      const settings = getSettings();
      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        'BOT_sinerr',
        settings.main.mediaServerType
      );

      // 1) 插件权威播放记录（电影 + 单集两类）
      const [movieActivity, episodeActivity] = await Promise.all([
        jellyfinClient.getAllUserPlaybackActivity(
          targetUser.jellyfinUserId,
          'Movie'
        ),
        jellyfinClient.getAllUserPlaybackActivity(
          targetUser.jellyfinUserId,
          'Episode'
        ),
      ]);

      // 2) 电影：ItemId(=jellyfinMediaId) → Media.tmdbId
      const movieMediaIds = movieActivity.map((a) => a.ItemId).filter(Boolean);
      const movieMediaRows = movieMediaIds.length
        ? await getRepository(Media)
            .createQueryBuilder('media')
            .where('media.jellyfinMediaId IN (:...ids)', {
              ids: movieMediaIds,
            })
            .getMany()
        : [];
      const movieByJellyfinId = new Map(
        movieMediaRows.map((m) => [m.jellyfinMediaId, m])
      );

      // 3) 单集：ItemId(=jellyfinEpisodeId) → Episode(media)
      const episodeJellyfinIds = episodeActivity
        .map((a) => a.ItemId)
        .filter(Boolean);
      const episodeRows = episodeJellyfinIds.length
        ? await getRepository(Episode)
            .createQueryBuilder('episode')
            .leftJoinAndSelect('episode.media', 'media')
            .where('episode.jellyfinEpisodeId IN (:...ids)', {
              ids: episodeJellyfinIds,
            })
            .getMany()
        : [];
      const episodeByJellyfinId = new Map(
        episodeRows.map((ep) => [ep.jellyfinEpisodeId, ep])
      );

      // 4) 本用户评分：tmdbId → rating
      const reviewRows = await getRepository(MediaReview)
        .createQueryBuilder('review')
        .leftJoinAndSelect('review.media', 'media')
        .where('review.userId = :userId', { userId })
        .getMany();
      const ratingByTmdb = new Map<number, number>();
      for (const review of reviewRows) {
        if (
          review.media?.tmdbId != null &&
          !ratingByTmdb.has(review.media.tmdbId)
        ) {
          ratingByTmdb.set(review.media.tmdbId, review.rating);
        }
      }

      // 5) 电影聚合
      const watchedById = new Map<number, WatchedItem>();
      for (const activity of movieActivity) {
        const media = movieByJellyfinId.get(activity.ItemId);
        if (!media) continue;
        const item: WatchedItem = {
          tmdbId: media.tmdbId,
          mediaType: 'movie',
          playCount: activity.PlayCount,
          playDurationSeconds: activity.PlayDurationSeconds,
          rating: ratingByTmdb.get(media.tmdbId) ?? null,
        };
        watchedById.set(media.tmdbId, item);
      }

      // 6) 剧集聚合：先算每部剧的已看集数集合，再查本地总集数
      const watchedCountByMediaId = new Map<number, number>();
      const mediaIdSet = new Set<number>();
      for (const activity of episodeActivity) {
        const ep = episodeByJellyfinId.get(activity.ItemId);
        if (!ep?.media?.id) continue;
        mediaIdSet.add(ep.media.id);
        watchedCountByMediaId.set(
          ep.media.id,
          (watchedCountByMediaId.get(ep.media.id) ?? 0) + 1
        );
      }

      const tvMediaRows = mediaIdSet.size
        ? await getRepository(Media)
            .createQueryBuilder('media')
            .where('media.id IN (:...ids)', { ids: [...mediaIdSet] })
            .getMany()
        : [];
      const totalCountByMediaId = new Map<number, number>();
      if (mediaIdSet.size) {
        const countRows = await getRepository(Episode)
          .createQueryBuilder('episode')
          .select('episode.mediaId', 'mediaId')
          .addSelect('COUNT(1)', 'total')
          .where('episode.mediaId IN (:...ids)', { ids: [...mediaIdSet] })
          .groupBy('episode.mediaId')
          .getRawMany<{ mediaId: string; total: string }>();
        for (const row of countRows) {
          totalCountByMediaId.set(Number(row.mediaId), Number(row.total));
        }
      }
      for (const media of tvMediaRows) {
        const watchedCount = watchedCountByMediaId.get(media.id) ?? 0;
        const totalCount = totalCountByMediaId.get(media.id) ?? 0;
        watchedById.set(media.tmdbId, {
          tmdbId: media.tmdbId,
          mediaType: 'tv',
          playCount: watchedCount,
          playDurationSeconds: 0,
          completed: totalCount > 0 && watchedCount >= totalCount,
          watchedCount,
          totalCount,
          watchedPercent: totalCount
            ? Math.round((watchedCount / totalCount) * 100)
            : 0,
          rating: ratingByTmdb.get(media.tmdbId) ?? null,
        });
      }

      // 7) 本地回退：插件为空时用 PlaybackEvent（兼容未装插件的部署）
      if (watchedById.size === 0) {
        const events = await getRepository(PlaybackEvent)
          .createQueryBuilder('event')
          .leftJoinAndSelect('event.user', 'user')
          .where('user.id = :userId', { userId })
          .orderBy('event.createdAt', 'DESC')
          .take(500)
          .getMany();
        const seen = new Set<string>();
        for (const event of events) {
          const key =
            event.mediaType === MediaType.TV
              ? `tv-${event.tmdbId}`
              : `movie-${event.tmdbId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const existing = watchedById.get(event.tmdbId);
          if (existing) {
            existing.completed = existing.completed || event.completed;
            existing.playDurationSeconds += event.durationSeconds;
            continue;
          }
          watchedById.set(event.tmdbId, {
            tmdbId: event.tmdbId,
            mediaType: event.mediaType,
            playCount: 1,
            playDurationSeconds: event.durationSeconds,
            completed: event.completed,
            rating: ratingByTmdb.get(event.tmdbId) ?? null,
          });
        }
      }

      // 8) 排序 + 分页
      const all = [...watchedById.values()].sort(
        (a, b) =>
          b.playCount - a.playCount ||
          b.playDurationSeconds - a.playDurationSeconds
      );
      const take = req.query.take ? Number(req.query.take) : 24;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const slice = all.slice(skip, skip + take);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(all.length / take),
          pageSize: take,
          results: all.length,
          page: Math.floor(skip / take) + 1,
        },
        results: slice,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

/**
 * 年度报告：按年份聚合插件播放记录（电影 + 单集），
 * 输出总时长 / 播放次数 / 去重媒体数 / 金榜 TOP / 按月下钻。
 *
 * 可见范围：本人或具备 MANAGE_USERS / MANAGE_REQUESTS 权限。
 */
router.get<{ id: string }, UserReportResponse>(
  '/:id/report',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const targetUser = await getRepository(User).findOneOrFail({
        where: { id: userId },
      });

      const year = req.query.year
        ? Number(req.query.year)
        : new Date().getFullYear();
      const since = new Date(year, 0, 1);
      const until = new Date(year + 1, 0, 1);

      const settings = getSettings();
      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        'BOT_sinerr',
        settings.main.mediaServerType
      );

      const events = targetUser.jellyfinUserId
        ? await jellyfinClient.getUserPlaybackEvents(
            targetUser.jellyfinUserId,
            since,
            until
          )
        : [];

      // 本地回退：插件未安装/无数据时，用 webhook 写入的 PlaybackEvent 聚合，
      // 保证报告在未装 Playback Reporting 插件的部署下也有内容（与 watched 回退一致）。
      if (events.length === 0) {
        const localEvents = await getRepository(PlaybackEvent)
          .createQueryBuilder('event')
          .leftJoinAndSelect('event.user', 'user')
          .where('user.id = :userId', { userId })
          .andWhere('event.createdAt >= :since', { since })
          .andWhere('event.createdAt < :until', { until })
          .getMany();

        if (localEvents.length === 0) {
          return res.status(200).json({
            year,
            totalSeconds: 0,
            playCount: 0,
            watchedTitles: 0,
            completedTitles: 0,
            movieTitles: 0,
            tvTitles: 0,
            topItems: [],
            months: [],
          });
        }

        const localParsed = localEvents.map((event) => ({
          tmdbId: event.tmdbId,
          mediaType: event.mediaType,
          seconds: event.durationSeconds,
          month: event.createdAt ? event.createdAt.getMonth() + 1 : 0,
        }));

        const localTotal = localParsed.reduce((sum, e) => sum + e.seconds, 0);
        const localUnique = new Set(localParsed.map((e) => e.tmdbId));
        const localMovies = new Set(
          localParsed
            .filter((e) => e.mediaType === 'movie')
            .map((e) => e.tmdbId)
        );
        const localTv = new Set(
          localParsed.filter((e) => e.mediaType === 'tv').map((e) => e.tmdbId)
        );
        const localAgg = new Map<
          number,
          { mediaType: 'movie' | 'tv'; playCount: number; seconds: number }
        >();
        for (const event of localParsed) {
          const cur = localAgg.get(event.tmdbId) ?? {
            mediaType: event.mediaType,
            playCount: 0,
            seconds: 0,
          };
          cur.playCount += 1;
          cur.seconds += event.seconds;
          localAgg.set(event.tmdbId, cur);
        }
        const localTop = [...localAgg.entries()]
          .sort((a, b) => b[1].seconds - a[1].seconds)
          .slice(0, 3)
          .map(([tmdbId, v]) => ({
            tmdbId,
            mediaType: v.mediaType,
            playCount: v.playCount,
            playDurationSeconds: v.seconds,
          }));

        const localMonthsMap = new Map<number, ReportMonth>();
        for (let m = 1; m <= 12; m++) {
          localMonthsMap.set(m, {
            month: m,
            playCount: 0,
            playDurationSeconds: 0,
            titleCount: 0,
            items: [],
          });
        }
        const localPerMonth = new Map<
          string,
          { playCount: number; seconds: number }
        >();
        for (const event of localParsed) {
          if (event.month === 0) continue;
          const monthInfo = localMonthsMap.get(event.month);
          if (monthInfo) {
            monthInfo.playCount += 1;
            monthInfo.playDurationSeconds += event.seconds;
          }
          const key = `${event.month}-${event.tmdbId}`;
          const cur = localPerMonth.get(key) ?? { playCount: 0, seconds: 0 };
          cur.playCount += 1;
          cur.seconds += event.seconds;
          localPerMonth.set(key, cur);
        }
        for (const [key, v] of localPerMonth.entries()) {
          const [mStr, tStr] = key.split('-');
          const month = Number(mStr);
          const monthInfo = localMonthsMap.get(month);
          if (monthInfo) {
            const sample = localParsed.find(
              (e) => e.month === month && e.tmdbId === Number(tStr)
            );
            monthInfo.items.push({
              tmdbId: Number(tStr),
              mediaType: sample?.mediaType ?? 'tv',
              playCount: v.playCount,
              playDurationSeconds: v.seconds,
            });
            monthInfo.titleCount = new Set(
              localParsed.filter((e) => e.month === month).map((e) => e.tmdbId)
            ).size;
          }
        }
        for (const monthInfo of localMonthsMap.values()) {
          monthInfo.items.sort(
            (a, b) => b.playDurationSeconds - a.playDurationSeconds
          );
        }

        return res.status(200).json({
          year,
          totalSeconds: localTotal,
          playCount: localParsed.length,
          watchedTitles: localUnique.size,
          completedTitles: new Set(
            localEvents.filter((e) => e.completed).map((e) => e.tmdbId)
          ).size,
          movieTitles: localMovies.size,
          tvTitles: localTv.size,
          topItems: localTop,
          months: [...localMonthsMap.values()].filter((m) => m.playCount > 0),
        });
      }

      // 映射 ItemId → tmdbId（电影走 Media，单集走 Episode）
      const movieIds = events
        .filter((e) => e.ItemType === 'Movie')
        .map((e) => e.ItemId)
        .filter(Boolean);
      const episodeIds = events
        .filter((e) => e.ItemType !== 'Movie')
        .map((e) => e.ItemId)
        .filter(Boolean);

      const movieRows = movieIds.length
        ? await getRepository(Media)
            .createQueryBuilder('media')
            .where('media.jellyfinMediaId IN (:...ids)', { ids: movieIds })
            .getMany()
        : [];
      const movieTmdbByJellyfinId = new Map(
        movieRows.map((m) => [m.jellyfinMediaId, m.tmdbId])
      );
      const episodeRows = episodeIds.length
        ? await getRepository(Episode)
            .createQueryBuilder('episode')
            .leftJoinAndSelect('episode.media', 'media')
            .where('episode.jellyfinEpisodeId IN (:...ids)', {
              ids: episodeIds,
            })
            .getMany()
        : [];
      const episodeTmdbByJellyfinId = new Map(
        episodeRows.map((ep) => [ep.jellyfinEpisodeId, ep.media?.tmdbId])
      );

      // 逐条解析成 { tmdbId, mediaType, seconds, month }
      interface ParsedEvent {
        tmdbId: number;
        mediaType: 'movie' | 'tv';
        seconds: number;
        month: number;
      }
      const parsed: ParsedEvent[] = [];
      for (const event of events) {
        if (event.ItemType === 'Movie') {
          const tmdbId = movieTmdbByJellyfinId.get(event.ItemId);
          if (tmdbId == null) continue;
          const d = new Date(event.DateCreated);
          parsed.push({
            tmdbId,
            mediaType: 'movie',
            seconds: event.PlayDurationSeconds,
            month: isNaN(d.getTime()) ? 0 : d.getMonth() + 1,
          });
        } else {
          const tmdbId = episodeTmdbByJellyfinId.get(event.ItemId);
          if (tmdbId == null) continue;
          const d = new Date(event.DateCreated);
          parsed.push({
            tmdbId,
            mediaType: 'tv',
            seconds: event.PlayDurationSeconds,
            month: isNaN(d.getTime()) ? 0 : d.getMonth() + 1,
          });
        }
      }

      const totalSeconds = parsed.reduce((sum, e) => sum + e.seconds, 0);
      const uniqueTitles = new Set(parsed.map((e) => e.tmdbId));
      const movieTitles = new Set(
        parsed.filter((e) => e.mediaType === 'movie').map((e) => e.tmdbId)
      );
      const tvTitles = new Set(
        parsed.filter((e) => e.mediaType === 'tv').map((e) => e.tmdbId)
      );

      // 金榜：按媒体聚合时长，取 TOP
      const agg = new Map<
        number,
        { mediaType: 'movie' | 'tv'; playCount: number; seconds: number }
      >();
      for (const event of parsed) {
        const cur = agg.get(event.tmdbId) ?? {
          mediaType: event.mediaType,
          playCount: 0,
          seconds: 0,
        };
        cur.playCount += 1;
        cur.seconds += event.seconds;
        agg.set(event.tmdbId, cur);
      }
      const topItems = [...agg.entries()]
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .slice(0, 3)
        .map(([tmdbId, v]) => ({
          tmdbId,
          mediaType: v.mediaType,
          playCount: v.playCount,
          playDurationSeconds: v.seconds,
        }));

      // 按月下钻
      const monthsMap = new Map<number, ReportMonth>();
      for (let m = 1; m <= 12; m++) {
        monthsMap.set(m, {
          month: m,
          playCount: 0,
          playDurationSeconds: 0,
          titleCount: 0,
          items: [],
        });
      }
      const perMonthAgg = new Map<
        string,
        { playCount: number; seconds: number }
      >();
      for (const event of parsed) {
        if (event.month === 0) continue;
        const monthInfo = monthsMap.get(event.month);
        if (monthInfo) {
          monthInfo.playCount += 1;
          monthInfo.playDurationSeconds += event.seconds;
        }
        const key = `${event.month}-${event.tmdbId}`;
        const cur = perMonthAgg.get(key) ?? { playCount: 0, seconds: 0 };
        cur.playCount += 1;
        cur.seconds += event.seconds;
        perMonthAgg.set(key, cur);
      }
      for (const event of parsed) {
        if (event.month === 0) continue;
        const monthInfo = monthsMap.get(event.month);
        if (monthInfo) {
          monthInfo.titleCount = new Set(
            parsed.filter((e) => e.month === event.month).map((e) => e.tmdbId)
          ).size;
        }
      }
      for (const [key, v] of perMonthAgg.entries()) {
        const [monthStr, tmdbIdStr] = key.split('-');
        const month = Number(monthStr);
        const tmdbId = Number(tmdbIdStr);
        const monthInfo = monthsMap.get(month);
        if (monthInfo) {
          const event = parsed.find(
            (e) => e.month === month && e.tmdbId === tmdbId
          );
          monthInfo.items.push({
            tmdbId,
            mediaType: event?.mediaType ?? 'tv',
            playCount: v.playCount,
            playDurationSeconds: v.seconds,
          });
        }
      }
      for (const monthInfo of monthsMap.values()) {
        monthInfo.items.sort(
          (a, b) => b.playDurationSeconds - a.playDurationSeconds
        );
      }
      // 剔除整月无数据的月份
      const months = [...monthsMap.values()].filter((m) => m.playCount > 0);

      // 看完统计：插件无 completed 标记，用本地 webhook PlaybackEvent 补充
      const completedEvents = await getRepository(PlaybackEvent)
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.user', 'user')
        .where('user.id = :userId', { userId })
        .andWhere('event.completed = :completed', { completed: true })
        .andWhere('event.createdAt >= :since', { since })
        .andWhere('event.createdAt < :until', { until })
        .getMany();
      const completedTitles = new Set(completedEvents.map((e) => e.tmdbId))
        .size;

      return res.status(200).json({
        year,
        totalSeconds,
        playCount: parsed.length,
        watchedTitles: uniqueTitles.size,
        completedTitles,
        movieTitles: movieTitles.size,
        tvTitles: tvTitles.size,
        topItems,
        months,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

/**
 * 动态时间线：合并「观看 / 剧集更新 / 请求」三源，按时间倒序分页。
 *
 * - 观看：PlaybackEvent（webhook 推进，本地）；
 * - 更新：我请求/声援过的剧最近有新集（recentlyAdded 聚合）；
 * - 请求：我发起的请求（MediaRequest）。
 *
 * 可见范围：本人或具备 MANAGE_USERS / MANAGE_REQUESTS 权限。
 */
router.get<{ id: string }, UserActivityResponse>(
  '/:id/activity',
  async (req, res, next) => {
    try {
      const userId = Number(req.params.id);

      if (
        userId !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to view this user.',
        });
      }

      const take = req.query.take ? Number(req.query.take) : 10;
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const typeFilter = req.query.type
        ? (req.query.type as string)
        : undefined;

      // 三源各自取「可能进入本页窗口」的记录（保守取 50）
      const sourceLimit = Math.min(50, skip + take);

      // 观看源
      const watchEvents = await getRepository(PlaybackEvent)
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.user', 'user')
        .where('user.id = :userId', { userId })
        .orderBy('event.createdAt', 'DESC')
        .take(sourceLimit)
        .getMany();

      // 请求源
      const requestEvents = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .where('requestedBy.id = :userId', { userId })
        .orderBy('request.createdAt', 'DESC')
        .take(sourceLimit)
        .getMany();

      // 更新源：我请求/声援过的剧 + recentlyAdded 聚合
      const voteRepo = getRepository(RequestVote);
      const myRequests = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoin('request.requestedBy', 'requestedBy')
        .where('requestedBy.id = :userId', { userId })
        .getMany();
      const myVotes = await voteRepo.find({
        where: { user: { id: userId } },
        relations: { request: { media: true } },
      });
      const mediaIds = [
        ...new Set(
          [
            ...myRequests.map((r) => r.media?.id),
            ...myVotes.map((v) => v.request?.media?.id),
          ].filter((id): id is number => !!id)
        ),
      ];
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { results: updateItems } = await getRecentlyAdded(
        since,
        sourceLimit,
        0,
        { mediaIds }
      );

      // 合并 + 排序
      const items: ActivityItem[] = [];
      for (const event of watchEvents) {
        items.push({
          type: 'watch',
          createdAt: event.createdAt,
          media: { tmdbId: event.tmdbId, mediaType: event.mediaType },
          completed: event.completed,
          durationSeconds: event.durationSeconds,
          seasonNumber: event.seasonNumber,
          episodeNumber: event.episodeNumber,
        });
      }
      for (const request of requestEvents) {
        items.push({
          type: 'request',
          createdAt: request.createdAt,
          media: {
            tmdbId: request.media?.tmdbId ?? 0,
            mediaType: request.media?.mediaType ?? 'movie',
          },
          requestStatus: request.status,
        });
      }
      for (const item of updateItems) {
        items.push({
          type: 'update',
          createdAt: item.latestEventAt,
          media: item.media,
          episodeCount: item.episodeCount,
        });
      }

      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // 类型过滤（watch/update/request），在排序后、分页前执行
      const filteredItems =
        typeFilter && ['watch', 'update', 'request'].includes(typeFilter)
          ? items.filter((item) => item.type === typeFilter)
          : items;

      const slice = filteredItems.slice(skip, skip + take);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(filteredItems.length / take),
          pageSize: take,
          results: filteredItems.length,
          page: Math.floor(skip / take) + 1,
        },
        results: slice,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default router;
