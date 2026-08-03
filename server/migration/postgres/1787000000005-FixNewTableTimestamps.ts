import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 修复新增社交表的时间戳列类型
 *
 * 老表（media_request / issue / season 等）已由 FixIssueTimestamps 迁移
 * 改为 TIMESTAMP WITH TIME ZONE，但此后新增的 request_vote / media_review /
 * playback_event 建表时仍用了无时区的 TIMESTAMP。无时区列会被 postgres
 * 按数据库会话时区解释，导致「8 小时偏差」类问题（与实体映射的
 * timestamp with time zone 不一致）。此处统一改为带时区列，
 * 并把存量数据视为 UTC（与现有老表处理一致）。
 */
export class FixNewTableTimestamps1787000000005 implements MigrationInterface {
  name = 'FixNewTableTimestamps1787000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "request_vote"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "media_review"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "media_review"
        ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE
        USING "updatedAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "playback_event"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        ALTER TABLE "playback_event"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "media_review"
        ALTER COLUMN "updatedAt" TYPE TIMESTAMP
        USING "updatedAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "media_review"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
    await queryRunner.query(`
        ALTER TABLE "request_vote"
        ALTER COLUMN "createdAt" TYPE TIMESTAMP
        USING "createdAt" AT TIME ZONE 'UTC'
      `);
  }
}
