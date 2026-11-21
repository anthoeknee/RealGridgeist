import { Command, Declare, type CommandContext } from "seyfert";

@Declare({
  name: "ping",
  description: "Check bot latency and gateway status",
})
export default class PingCommand extends Command {
  override async run(ctx: CommandContext) {
    const ping = ctx.client.gateway.latency;

    await ctx.write({
      content: `🏓 Pong! Bot is online. Gateway latency is \`${ping}ms\`.`,
    });
  }
}
