import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import type {
  QuotaResponse,
  UserRequestsResponse,
  UserResultsResponse,
} from '@server/interfaces/api/userInterfaces';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';
import { nanoid } from 'nanoid';

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

    let query = getRepository(User).createQueryBuilder('user');

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
      const avatar =
        body.avatar ?? gravatarUrl(username, { default: 'mm', size: 200 });

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

          user.jellyfinUserId = account.Id;
          user.jellyfinUsername = account.Name;
          user.jellyfinDeviceId = deviceId;
          user.avatar = `/avatarproxy/${account.Id}`;
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
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { jellyfinUserIds: string[] };

      // taken from auth.ts
      const admin = await userRepository.findOneOrFail({
        where: { id: 1 },
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
        admin.jellyfinDeviceId ?? ''
      );
      const createdUsers: User[] = [];

      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
      const jellyfinUsers = await jellyfinClient.getUsers();

      const jellyfinUsersById = new Map(
        jellyfinUsers.users.map((user) => [
          normalizeJellyfinGuid(user.Id),
          user,
        ])
      );

      for (const rawJellyfinUserId of body.jellyfinUserIds) {
        const jellyfinUserId = normalizeJellyfinGuid(rawJellyfinUserId);
        if (!jellyfinUserId) {
          continue;
        }

        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);

        const user = await userRepository.findOne({
          select: ['id', 'jellyfinUserId'],
          where: { jellyfinUserId: jellyfinUserId },
        });

        if (!user) {
          const newUser = new User({
            jellyfinUsername: jellyfinUser?.Name,
            jellyfinUserId: jellyfinUserId,
            jellyfinDeviceId: Buffer.from(
              `BOT_sinerr_${jellyfinUser?.Name ?? ''}`
            ).toString('base64'),
            username: jellyfinUser?.Name,
            permissions: settings.main.defaultPermissions,
            avatar: `/avatarproxy/${jellyfinUserId}`,
            userType:
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY,
          });

          await userRepository.save(newUser);
          createdUsers.push(newUser);
        }
      }
      return res.status(201).json(User.filterMany(createdUsers));
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

export default router;
