import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserNickname1787000000002 implements MigrationInterface {
  name = 'AddUserNickname1787000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "nickname" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "nickname"`);
  }
}
