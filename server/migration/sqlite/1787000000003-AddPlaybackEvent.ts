import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaybackEvent1787000000003 implements MigrationInterface {
  name = 'AddPlaybackEvent1787000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "playback_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar NOT NULL, "completed" boolean NOT NULL DEFAULT (0), "seasonNumber" integer, "episodeNumber" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "userId" integer, CONSTRAINT "FK_PLAYBACK_EVENT_USER" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PLAYBACK_EVENT_USER" ON "playback_event" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PLAYBACK_EVENT_CREATED" ON "playback_event" ("createdAt") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PLAYBACK_EVENT_TMDB" ON "playback_event" ("tmdbId") `
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "playbackVisible" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "playback_event"`);
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "playbackVisible"`
    );
  }
}
