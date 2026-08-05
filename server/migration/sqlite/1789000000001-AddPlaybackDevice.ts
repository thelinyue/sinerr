import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlaybackDevice1789000000001 implements MigrationInterface {
  name = 'AddPlaybackDevice1789000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playback_event" ADD "deviceName" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "playback_event" DROP COLUMN "deviceName"`
    );
  }
}
