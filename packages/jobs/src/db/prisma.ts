import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __jobs_prisma_client__: PrismaClient | undefined;
}

const prisma =
  globalThis.__jobs_prisma_client__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__jobs_prisma_client__ = prisma;
}

export default prisma;
