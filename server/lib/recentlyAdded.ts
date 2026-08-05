import type { MediaType } from '@server/constants/media';
import { MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Episode from '@server/entity/Episode';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import RequestVote from '@server/entity/RequestVote';
import { In, MoreThanOrEqual } from 'typeorm';

/** 单集明细（供前端计算「最新更新点」） */
export interface NewEpisodeRef {
  seasonNumber: number;
  episodeNumber: number;
  addedAt: Date;
}

/** 最近事件项：media + 时间窗内新增集明细 + 声援数 */
export interface RecentlyAddedItem {
  media: { id: number; tmdbId: number; mediaType: MediaType };
  episodeCount: number;
  newEpisodes: NewEpisodeRef[];
  latestEventAt: Date;
  /** 媒体级声援数（按用户去重） */
  voteCount: number;
}

/**
 * 最近添加聚合（应用层组装，跨库兼容）
 *
 * 统一「最近事件」语义：新入库影视（mediaAddedAt ≥ since）+ 老剧新增单集。
 * 两查询内存归并（media 列表 + 时间窗内 episode 按 mediaId 分组），
 * 避免 sqlite/pg 的 JSON 聚合方言差异（决策 52）。
 */
export async function getRecentlyAdded(
  since: Date,
  take: number,
  skip: number,
  opts?: { mediaIds?: number[] }
): Promise<{ results: RecentlyAddedItem[]; total: number }> {
  const mediaRepo = getRepository(Media);
  const episodeRepo = getRepository(Episode);

  // 1) 窗口内新增单集（量级小）→ 涉及媒体 id，用于收窄候选集
  const windowEpisodes = await episodeRepo.find({
    where: { addedAt: MoreThanOrEqual(since) },
    relations: { media: true },
  });
  const episodeMediaIdSet = new Set<number>();
  for (const ep of windowEpisodes) {
    if (ep.media?.id) episodeMediaIdSet.add(ep.media.id);
  }

  // 2) 候选媒体：仅「窗口内新入库（mediaAddedAt >= since）」∪「窗口有新增集的媒体」
  //    避免拉全量可用媒体 + 巨型 IN（老库场景性能热点），跨库通用
  const statuses = [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE];
  const selectList = [
    'media.id',
    'media.tmdbId',
    'media.mediaType',
    'media.mediaAddedAt',
  ];
  const aRows = await mediaRepo
    .createQueryBuilder('media')
    .select(selectList)
    .where('media.status IN (:...statuses)', { statuses })
    .andWhere(
      'media.mediaAddedAt IS NOT NULL AND media.mediaAddedAt >= :since',
      {
        since,
      }
    )
    .getRawMany();
  const bRows = episodeMediaIdSet.size
    ? await mediaRepo
        .createQueryBuilder('media')
        .select(selectList)
        .where('media.status IN (:...statuses)', { statuses })
        .andWhere('media.id IN (:...ids)', { ids: [...episodeMediaIdSet] })
        .getRawMany()
    : [];

  const byId = new Map<number, (typeof aRows)[number]>();
  for (const r of [...aRows, ...bRows]) {
    if (!byId.has(r.media_id)) byId.set(r.media_id, r);
  }
  let mediaRows = [...byId.values()];
  if (opts?.mediaIds?.length) {
    const idSet = new Set(opts.mediaIds);
    mediaRows = mediaRows.filter((r) => idSet.has(r.media_id));
  }

  const mediaList = mediaRows.map((row) => ({
    id: row.media_id as number,
    tmdbId: row.media_tmdbId as number,
    mediaType: row.media_mediaType as MediaType,
    mediaAddedAt: row.media_mediaAddedAt
      ? new Date(row.media_mediaAddedAt)
      : null,
  }));

  const mediaIdSet = new Set(mediaList.map((m) => m.id));
  const episodes = windowEpisodes.filter(
    (ep) => ep.media?.id && mediaIdSet.has(ep.media.id)
  );

  const grouped = new Map<number, NewEpisodeRef[]>();
  for (const ep of episodes) {
    const arr = grouped.get(ep.media.id) ?? [];
    arr.push({
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      addedAt: ep.addedAt,
    });
    grouped.set(ep.media.id, arr);
  }

  const items: RecentlyAddedItem[] = [];
  for (const media of mediaList) {
    const newEpisodes = (grouped.get(media.id) ?? []).sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
    );
    const latestFromEpisodes = newEpisodes.length
      ? new Date(Math.max(...newEpisodes.map((e) => e.addedAt.getTime())))
      : null;

    // 只保留「窗口内新入库」或「窗口内有新增集」的媒体
    if (
      !latestFromEpisodes &&
      (!media.mediaAddedAt || media.mediaAddedAt < since)
    ) {
      continue;
    }

    const latestEventAt = latestFromEpisodes ?? (media.mediaAddedAt as Date);
    items.push({
      media: {
        id: media.id,
        tmdbId: media.tmdbId,
        mediaType: media.mediaType,
      },
      episodeCount: newEpisodes.length,
      newEpisodes,
      latestEventAt,
      voteCount: 0,
    });
  }

  items.sort((a, b) => b.latestEventAt.getTime() - a.latestEventAt.getTime());

  // 媒体级声援数（按用户去重，批量一次查询）
  const itemMediaIds = items.map((item) => item.media.id);
  const voteCountByMedia = new Map<number, number>();
  if (itemMediaIds.length > 0) {
    const requests = await getRepository(MediaRequest).find({
      where: { media: { id: In(itemMediaIds) } },
      select: { id: true, media: { id: true } },
      relations: { media: true },
    });
    const requestIdsByMedia = new Map<number, number[]>();
    for (const request of requests) {
      const mediaId = request.media?.id;
      if (!mediaId) continue;
      const arr = requestIdsByMedia.get(mediaId) ?? [];
      arr.push(request.id);
      requestIdsByMedia.set(mediaId, arr);
    }
    const allRequestIds = [...requestIdsByMedia.values()].flat();
    if (allRequestIds.length > 0) {
      const rows = await getRepository(RequestVote)
        .createQueryBuilder('vote')
        .select('DISTINCT vote.userId', 'userId')
        .addSelect('vote.requestId', 'requestId')
        .where('vote.requestId IN (:...ids)', { ids: allRequestIds })
        .getRawMany();
      const userIdsByMedia = new Map<number, Set<number>>();
      for (const row of rows) {
        const mediaId = [...requestIdsByMedia.entries()].find(([, ids]) =>
          ids.includes(Number(row.requestId))
        )?.[0];
        if (!mediaId) continue;
        const set = userIdsByMedia.get(mediaId) ?? new Set<number>();
        set.add(Number(row.userId));
        userIdsByMedia.set(mediaId, set);
      }
      for (const mediaId of itemMediaIds) {
        voteCountByMedia.set(mediaId, userIdsByMedia.get(mediaId)?.size ?? 0);
      }
    }
  }
  for (const item of items) {
    item.voteCount = voteCountByMedia.get(item.media.id) ?? 0;
  }

  return { results: items.slice(skip, skip + take), total: items.length };
}
