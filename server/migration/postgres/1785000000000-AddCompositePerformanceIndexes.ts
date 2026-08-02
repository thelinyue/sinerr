import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompositePerformanceIndexes1785000000000 implements MigrationInterface {
  name = 'AddCompositePerformanceIndexes1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_REQUEST_QUOTA" ON "media_request" ("requestedById", "createdAt", "status", "type")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_REQUEST_STATUS_USER" ON "media_request" ("status", "requestedById")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_UPDATED_AT" ON "media" ("updatedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_MEDIA_ADDED_AT" ON "media" ("mediaAddedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MEDIA_REQUEST_QUOTA"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_MEDIA_REQUEST_STATUS_USER"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MEDIA_UPDATED_AT"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MEDIA_ADDED_AT"`);
  }
}
