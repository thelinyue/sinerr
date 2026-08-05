import type { MediaType } from '@server/constants/media';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

/**
 * 播放记录实体
 *
 * 由 Emby/Jellyfin 的 Webhook 播放通知（playback.start / playback.stop）写入，
 * 用于动态信息流中的「播放」类型条目。
 *
 * - 通过 Provider_tmdb 直接解析 tmdbId，无需额外调用 Jellyfin API。
 * - completed 标记是否看完（PlayedToCompletion=true 或完成度达到阈值）。
 * - 可见性：默认全站可见，用户可在设置中关闭；管理员始终可见（查询时过滤）。
 */
@Entity()
@Index('IDX_PLAYBACK_EVENT_USER', ['user'])
@Index('IDX_PLAYBACK_EVENT_CREATED', ['createdAt'])
@Index('IDX_PLAYBACK_DEDUPE', [
  'user',
  'tmdbId',
  'mediaType',
  'seasonNumber',
  'episodeNumber',
])
class PlaybackEvent {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public user: User;

  @Column()
  @Index()
  public tmdbId: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  /** 是否看完（PlayedToCompletion=true） */
  @Column({ default: false })
  public completed: boolean;

  /** 本次播放时长（秒）。playback.stop 时用 PositionTicks 计算 */
  @Column({ type: 'integer', default: 0 })
  public durationSeconds: number;

  @Column({ type: 'integer', nullable: true })
  public seasonNumber?: number | null;

  @Column({ type: 'integer', nullable: true })
  public episodeNumber?: number | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<PlaybackEvent>) {
    Object.assign(this, init);
  }
}

export default PlaybackEvent;
