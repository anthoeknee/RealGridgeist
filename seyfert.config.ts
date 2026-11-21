import { config } from "seyfert";

export default config.bot({
  token: Bun.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN ?? "",
  intents: [
    "Guilds",
    "GuildMessages",
    "MessageContent",
    "DirectMessages",
  ],
  locations: {
    base: "src",
    commands: "commands",
    events: "events",
  },
});
