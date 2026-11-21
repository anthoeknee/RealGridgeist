import { createEvent } from "seyfert";
import { env } from "../env";

export default createEvent({
  data: {
    name: "botReady",
    once: true,
  },
  run(user, client) {
    client.logger.info(
      `🤖 ${user.username} is ready and connected to Discord! (env: ${env.NODE_ENV})`,
    );
  },
});
