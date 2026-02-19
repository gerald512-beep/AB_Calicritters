import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
} from "@prisma/client/runtime/library";

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (error instanceof PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof PrismaClientRustPanicError) {
    return true;
  }

  if (error instanceof PrismaClientKnownRequestError) {
    return error.code === "P1000" || error.code === "P1001";
  }

  if (error instanceof Error) {
    return /database|connection|connect|timeout|ECONNREFUSED|ENOTFOUND/i.test(error.message);
  }

  return false;
}
