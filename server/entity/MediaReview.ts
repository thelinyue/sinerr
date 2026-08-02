import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';
import { User } from './User';

/**
 * 媒体短评实体
 *
 * 用户在媒体详情页发表 1-5 星评分 + 一句话短评。
 * - 通过 Media 实体关联（tmdbId + mediaType 唯一标识），电影与剧集共用同一套短评。
 * - 发表短评鉴权复用 `REQUEST` 权限（见设计文档决策点 5）。
 * - 修改/删除：作者可删自己的；管理员（MANAGE_REQUESTS）可删任意短评。
 */
@Entity()
@Index('IDX_MEDIA_REVIEW_MEDIA', ['media'])
@Index('IDX_MEDIA_REVIEW_USER', ['user'])
class MediaReview {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.mediaReviews, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public user: User;

  /** 评分 1-5，5 为最高 */
  @Column({ type: 'integer', default: 5 })
  public rating: number;

  /** 短评内容（一句话） */
  @Column({ type: 'text' })
  public message: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<MediaReview>) {
    Object.assign(this, init);
  }
}

export default MediaReview;
