import { Client, type ParseClient } from "seyfert";
import { closeDatabase } from "./memory/db";

declare module "seyfert" {
  interface SeyfertRegistry {
    client: ParseClient<Client<true>>;
  }
}

const client = new Client();

export { client };

function handleShutdown(signal: string) {
  client.logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    client.gateway?.disconnectAll();
  } catch (error) {
    client.logger.error("Error while disconnecting gateway shards:", error);
  }
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

if (import.meta.main) {
  client
    .start()
    .then(() => client.uploadCommands())
    .catch((err) => {
      client.logger.error("Failed to start bot:", err);
      process.exit(1);
    });
}
