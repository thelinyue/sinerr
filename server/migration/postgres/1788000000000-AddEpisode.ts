import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEpisode1788000000000 implements MigrationInterface {
  name = 'AddEpisode1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "episode" ("id" SERIAL NOT NULL, "seasonNumber" integer NOT NULL, "episodeNumber" integer NOT NULL, "jellyfinEpisodeId" character varying, "addedAt" TIMESTAMP NOT NULL DEFAULT now(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "mediaId" integer, CONSTRAINT "PK_episode" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_EPISODE_JELLYFIN_ID" ON "episode" ("jellyfinEpisodeId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EPISODE_MEDIA_ADDED" ON "episode" ("mediaId", "addedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EPISODE_MEDIA_SEASON" ON "episode" ("mediaId", "seasonNumber")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_EPISODE_MEDIA" ON "episode" ("mediaId")`
    );
    await queryRunner.query(
      `ALTER TABLE "episode" ADD CONSTRAINT "FK_EPISODE_MEDIA" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "episode" DROP CONSTRAINT "FK_EPISODE_MEDIA"`
    );
    await queryRunner.query(`DROP TABLE "episode"`);
  }
}
