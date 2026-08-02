import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestVote1786000000000 implements MigrationInterface {
  name = 'AddRequestVote1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "request_vote" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "requestId" integer, "userId" integer, CONSTRAINT "IDX_REQUEST_VOTE_UNIQUE" UNIQUE ("requestId", "userId"), CONSTRAINT "FK_REQUEST_VOTE_REQUEST" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_REQUEST_VOTE_USER" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_REQUEST_VOTE_REQUEST" ON "request_vote" ("requestId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_REQUEST_VOTE_USER" ON "request_vote" ("userId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "request_vote"`);
  }
}
