import { createEvent } from "seyfert";

export default createEvent({
  data: {
    name: "botReady",
    once: true,
  },
  run(user, client) {
    client.logger.info(`${user.username} is ready and connected to Discord!`);
  },
});
