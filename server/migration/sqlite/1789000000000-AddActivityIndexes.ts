import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivityIndexes1789000000000 implements MigrationInterface {
  name = 'AddActivityIndexes1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 动态 count / activity 时间窗查询：各表 createdAt 单列索引
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_REQUEST_CREATED" ON "media_request" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_REQUEST_VOTE_CREATED" ON "request_vote" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ISSUE_CREATED" ON "issue" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_REVIEW_CREATED" ON "media_review" ("createdAt")`
    );
    // 播放 Webhook 去重 + /activity/watched 观看者聚合：复合索引
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_PLAYBACK_DEDUPE" ON "playback_event" ("userId", "tmdbId", "mediaType", "seasonNumber", "episodeNumber")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MEDIA_REQUEST_CREATED"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_REQUEST_VOTE_CREATED"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ISSUE_CREATED"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MEDIA_REVIEW_CREATED"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_PLAYBACK_DEDUPE"`);
  }
}
