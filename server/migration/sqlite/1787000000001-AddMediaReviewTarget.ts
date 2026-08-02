import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaReviewTarget1787000000001 implements MigrationInterface {
  name = 'AddMediaReviewTarget1787000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "temporary_media_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "rating" integer NOT NULL DEFAULT (5), "message" text NOT NULL, "seasonNumber" integer, "episodeNumber" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, "userId" integer, CONSTRAINT "FK_MEDIA_REVIEW_MEDIA" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_MEDIA_REVIEW_USER" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_media_review"("id", "rating", "message", "createdAt", "updatedAt", "mediaId", "userId") SELECT "id", "rating", "message", "createdAt", "updatedAt", "mediaId", "userId" FROM "media_review"`
    );
    await queryRunner.query(`DROP TABLE "media_review"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_media_review" RENAME TO "media_review"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_MEDIA" ON "media_review" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_USER" ON "media_review" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_TARGET" ON "media_review" ("mediaId", "seasonNumber", "episodeNumber") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "media_review"`);
  }
}
