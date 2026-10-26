import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db.js";
import { logger } from "./logger.js";

const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(async (error) => {
    if (error) logger.error({ err: error }, "HTTP server shutdown failed");
    await prisma.$disconnect();
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
