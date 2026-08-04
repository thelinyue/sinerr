import type { MediaType } from '@server/constants/media';
import { MediaStatus } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import type { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import { getHostname } from '@server/utils/getHostname';
import {
  AfterLoad,
  Column,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import Episode from './Episode';
import Issue from './Issue';
import { MediaRequest } from './MediaRequest';
import MediaReview from './MediaReview';
import Season from './Season';

export interface DownloadingItem {
  downloadId: string;
  title: string;
  size: number;
  sizeleft: number;
  sizeLeft: number;
  timeleft: string;
  status: string;
  externalId: string;
  estimatedCompletionTime: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
  };
}

@Entity()
@Index(['tmdbId', 'mediaType'])
@Index('IDX_MEDIA_UPDATED_AT', ['updatedAt'])
@Index('IDX_MEDIA_ADDED_AT', ['mediaAddedAt'])
class Media {
  public static async getRelatedMedia(
    user: User | undefined,
    items: { tmdbId: number; mediaType: string }[]
  ): Promise<Media[]> {
    const mediaRepository = getRepository(Media);

    try {
      if (items.length === 0) {
        return [];
      }

      const finalIds = [...new Set(items.map((i) => i.tmdbId))];

      const media = await mediaRepository
        .createQueryBuilder('media')
        .where(' media.tmdbId in (:...finalIds)', { finalIds })
        .getMany();

      return media.filter((m) =>
        items.some((i) => i.tmdbId === m.tmdbId && i.mediaType === m.mediaType)
      );
    } catch (e) {
      logger.error(e.message);
      return [];
    }
  }

  public static async getMedia(
    id: number,
    mediaType: MediaType
  ): Promise<Media | undefined> {
    const mediaRepository = getRepository(Media);

    try {
      const media = await mediaRepository.findOne({
        where: { tmdbId: id, mediaType: mediaType },
        relations: { requests: true, issues: true },
      });

      return media ?? undefined;
    } catch (e) {
      logger.error(e.message);
      return undefined;
    }
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column()
  @Index()
  public tmdbId: number;

  @Column({ unique: true, nullable: true })
  @Index()
  public tvdbId?: number;

  @Column({ nullable: true })
  @Index()
  public imdbId?: string;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  @Index()
  public status: MediaStatus;

  @OneToMany(() => MediaRequest, (request) => request.media, {
    cascade: ['insert', 'remove'],
  })
  public requests: MediaRequest[];

  @OneToMany(() => Season, (season) => season.media, {
    cascade: true,
    eager: true,
  })
  public seasons: Season[];

  @OneToMany(() => Issue, (issue) => issue.media, { cascade: true })
  public issues: Issue[];

  @OneToMany(() => MediaReview, (review) => review.media, {
    cascade: ['insert', 'remove'],
  })
  public mediaReviews: MediaReview[];

  @OneToMany(() => Episode, (episode) => episode.media, {
    cascade: ['insert', 'remove'],
  })
  public episodes: Episode[];

  @OneToOne(() => Blocklist, (blocklist) => blocklist.media)
  public blocklist: Promise<Blocklist>;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  /**
   * The `lastSeasonChange` column stores the date and time when the media was added to the library.
   * It needs to be database-aware because SQLite supports `datetime` while PostgreSQL supports `timestamp with timezone (timestampz)`.
   */
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public lastSeasonChange: Date;

  /**
   * The `mediaAddedAt` column stores the date and time when the media was added to the library.
   * It needs to be database-aware because SQLite supports `datetime` while PostgreSQL supports `timestamp with timezone (timestampz)`.
   * This column is nullable because it can be null when the media is not yet synced to the library.
   */
  @DbAwareColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    nullable: true,
  })
  public mediaAddedAt: Date;

  @Column({ nullable: true, type: 'int' })
  public serviceId?: number | null;

  @Column({ nullable: true, type: 'int' })
  public externalServiceId?: number | null;

  @Column({ nullable: true, type: 'varchar' })
  public externalServiceSlug?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  public jellyfinMediaId?: string | null;

  public serviceUrl?: string;
  public downloadStatus?: DownloadingItem[] = [];

  public mediaUrl?: string;

  /** 最近入库单集（F3：详情页季行「最近新增」chip，非 DB 字段） */
  public recentEpisodes?: {
    seasonNumber: number;
    episodeNumber: number;
    addedAt: Date;
  }[];

  public tautulliUrl?: string;

  constructor(init?: Partial<Media>) {
    Object.assign(this, init);
  }

  public resetServiceData(): void {
    this.serviceId = null;
    this.externalServiceId = null;
    this.externalServiceSlug = null;
    this.jellyfinMediaId = null;
  }

  @AfterLoad()
  public setMediaUrls(): void {
    const pageName =
      getSettings().main.mediaServerType == MediaServerType.EMBY
        ? 'item'
        : 'details';
    const { serverId, externalHostname } = getSettings().jellyfin;
    const jellyfinHost =
      externalHostname && externalHostname.length > 0
        ? externalHostname
        : getHostname();

    if (this.jellyfinMediaId) {
      this.mediaUrl = `${jellyfinHost}/web/index.html#!/${pageName}?id=${this.jellyfinMediaId}&context=home&serverId=${serverId}`;
    }
  }

  @AfterLoad()
  public setServiceUrl(): void {}
}

export default Media;
