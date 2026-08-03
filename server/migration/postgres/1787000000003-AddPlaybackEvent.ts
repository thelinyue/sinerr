import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaybackEvent1787000000003 implements MigrationInterface {
  name = 'AddPlaybackEvent1787000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "playback_event" ("id" SERIAL NOT NULL, "tmdbId" integer NOT NULL, "mediaType" character varying NOT NULL, "completed" boolean NOT NULL DEFAULT false, "seasonNumber" integer, "episodeNumber" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer, CONSTRAINT "PK_playback_event" PRIMARY KEY ("id"))`
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
      `ALTER TABLE "playback_event" ADD CONSTRAINT "FK_PLAYBACK_EVENT_USER" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "playbackVisible" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playback_event" DROP CONSTRAINT "FK_PLAYBACK_EVENT_USER"`
    );
    await queryRunner.query(`DROP TABLE "playback_event"`);
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "playbackVisible"`
    );
  }
}
