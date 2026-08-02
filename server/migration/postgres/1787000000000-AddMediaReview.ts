import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaReview1787000000000 implements MigrationInterface {
  name = 'AddMediaReview1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_review" ("id" SERIAL NOT NULL, "rating" integer NOT NULL DEFAULT '5', "message" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "mediaId" integer, "userId" integer, CONSTRAINT "PK_media_review" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_MEDIA" ON "media_review" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_MEDIA_REVIEW_USER" ON "media_review" ("userId") `
    );
    await queryRunner.query(
      `ALTER TABLE "media_review" ADD CONSTRAINT "FK_MEDIA_REVIEW_MEDIA" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "media_review" ADD CONSTRAINT "FK_MEDIA_REVIEW_USER" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_review" DROP CONSTRAINT "FK_MEDIA_REVIEW_USER"`
    );
    await queryRunner.query(
      `ALTER TABLE "media_review" DROP CONSTRAINT "FK_MEDIA_REVIEW_MEDIA"`
    );
    await queryRunner.query(`DROP TABLE "media_review"`);
  }
}
