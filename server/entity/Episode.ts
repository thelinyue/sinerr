import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import Media from './Media';

/**
 * 单集记录（媒体库剧集结构的本地镜像）
 *
 * 由扫描器（processShow）在拉取 Jellyfin/Emby 单集时写入，跟踪单集入库时间
 * （addedAt = Jellyfin DateCreated），支撑「最近添加 / 更新集数 / 追更通知 /
 * 按季进度」等功能。
 *
 * - jellyfinEpisodeId 为去重键：只插不更（ON CONFLICT DO NOTHING），稳态零写放大。
 * - media 关联删除时 CASCADE 清理。
 */
@Entity()
@Index('IDX_EPISODE_MEDIA_ADDED', ['media', 'addedAt'])
@Index('IDX_EPISODE_MEDIA_SEASON', ['media', 'seasonNumber'])
class Episode {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.episodes, {
    onDelete: 'CASCADE',
  })
  @Index('IDX_EPISODE_MEDIA')
  public media: Media;

  @Column({ type: 'int' })
  public seasonNumber: number;

  @Column({ type: 'int' })
  public episodeNumber: number;

  /** Jellyfin/Emby 单集 ID，upsert 去重键 */
  @Column({ type: 'varchar', nullable: true })
  @Index('UQ_EPISODE_JELLYFIN_ID', { unique: true })
  public jellyfinEpisodeId?: string;

  /** 入库时间：取 Jellyfin/Emby 单集 DateCreated */
  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public addedAt: Date;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<Episode>) {
    Object.assign(this, init);
  }
}

export default Episode;
