import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MediaRequest } from './MediaRequest';
import { User } from './User';

/**
 * 请求声援（点赞）实体
 *
 * 记录某个用户对某条媒体请求表达「我也想看」的意向。
 * - 每个用户对每条请求只能点赞一次，由联合唯一索引保证幂等。
 * - 点赞作为轻量社交表达，鉴权挂载在 Permission.VOTE 上。
 */
@Entity()
@Index('IDX_REQUEST_VOTE_UNIQUE', ['request', 'user'], { unique: true })
@Index('IDX_REQUEST_VOTE_CREATED', ['createdAt'])
class RequestVote {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => MediaRequest, (request) => request.votes, {
    onDelete: 'CASCADE',
  })
  @Index('IDX_REQUEST_VOTE_REQUEST')
  public request: MediaRequest;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index('IDX_REQUEST_VOTE_USER')
  public user: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<RequestVote>) {
    Object.assign(this, init);
  }
}

export default RequestVote;
