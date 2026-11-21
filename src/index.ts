import { Client, type ParseClient } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { env } from "./env";
import { initDatabase, closeDatabase, defaultMessageBuffer } from "./memory";
import { permissions } from "./middlewares/permissions";

const middlewares = {
  permissions,
};

declare module "seyfert" {
  interface SeyfertRegistry {
    client: ParseClient<Client<true>>;
    middlewares: typeof middlewares;
  }
}

const client = new Client({
  globalMiddlewares: ["permissions"],
  commands: {
    defaults: {
      onMiddlewaresError(context, error) {
        return context.editOrReply({
          content: `⛔ ${error}`,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  },
});

client.setServices({
  middlewares,
});

export { client };

function handleShutdown(signal: string) {
  client.logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    client.gateway?.disconnectAll();
  } catch (error) {
    client.logger.error("Error while disconnecting gateway shards:", error);
  }
  defaultMessageBuffer.stopCleanupTimer();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

if (import.meta.main) {
  client.logger.info(`Starting bot in ${env.NODE_ENV} mode...`);

  // Initialize SQLite database and run migrations before connecting
  initDatabase(env.DATABASE_PATH);
  client.logger.info(`SQLite memory layer connected at ${env.DATABASE_PATH}`);

  client
    .start()
    .then(() => client.uploadCommands())
    .catch((err) => {
      client.logger.error("Failed to start bot:", err);
      process.exit(1);
    });
}
