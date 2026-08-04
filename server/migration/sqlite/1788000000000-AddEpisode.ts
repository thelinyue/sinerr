import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEpisode1788000000000 implements MigrationInterface {
  name = 'AddEpisode1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "episode" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "episodeNumber" integer NOT NULL, "jellyfinEpisodeId" varchar, "addedAt" datetime NOT NULL DEFAULT (datetime('now')), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, CONSTRAINT "FK_EPISODE_MEDIA" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "episode"`);
  }
}
