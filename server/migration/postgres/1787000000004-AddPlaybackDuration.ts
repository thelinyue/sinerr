import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaybackDuration1787000000004 implements MigrationInterface {
  name = 'AddPlaybackDuration1787000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playback_event" ADD "durationSeconds" integer NOT NULL DEFAULT 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playback_event" DROP COLUMN "durationSeconds"`
    );
  }
}
