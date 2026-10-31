import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/mortus.db";
const migrationTestDatabaseUrl = "file:./.mortus-test/migration-test.db";

if (
  process.env.MORTUS_TEST_ENV === "1" &&
  (databaseUrl !== migrationTestDatabaseUrl || process.env.MORTUS_TEST_DATABASE_URL !== migrationTestDatabaseUrl)
) {
  throw new Error("Modo de teste interrompido: Prisma Client não está apontado para o SQLite temporário esperado.");
}

const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
