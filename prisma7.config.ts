import "dotenv/config";
import { defineConfig } from "prisma/config";

const migrationTestDatabaseUrl = "file:./.mortus-test/migration-test.db";
const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/mortus.db";

if (
  process.env.MORTUS_TEST_ENV === "1" &&
  (databaseUrl !== migrationTestDatabaseUrl || process.env.MORTUS_TEST_DATABASE_URL !== migrationTestDatabaseUrl)
) {
  throw new Error("Modo de teste interrompido: DATABASE_URL não aponta para o SQLite temporário esperado.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
