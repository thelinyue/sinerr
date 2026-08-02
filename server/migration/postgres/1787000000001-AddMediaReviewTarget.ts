import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaReviewTarget1787000000001 implements MigrationInterface {
  name = 'AddMediaReviewTarget1787000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_review" ADD "seasonNumber" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "media_review" ADD "episodeNumber" integer`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_TARGET" ON "media_review" ("mediaId", "seasonNumber", "episodeNumber") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_MEDIA_REVIEW_TARGET"`);
    await queryRunner.query(
      `ALTER TABLE "media_review" DROP COLUMN "episodeNumber"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_review" DROP COLUMN "seasonNumber"`
    );
  }
}
