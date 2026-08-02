import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaReview1787000000000 implements MigrationInterface {
  name = 'AddMediaReview1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_review" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "rating" integer NOT NULL DEFAULT (5), "message" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, "userId" integer, CONSTRAINT "FK_MEDIA_REVIEW_MEDIA" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_MEDIA_REVIEW_USER" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_MEDIA" ON "media_review" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_USER" ON "media_review" ("userId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "media_review"`);
  }
}
