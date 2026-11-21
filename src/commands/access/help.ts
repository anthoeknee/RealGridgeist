import { Declare, SubCommand, type CommandContext } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";

@Declare({
  name: "help",
  description: "Explain how bot permissions, scopes, and access levels work",
  props: { access: "admin" },
})
export default class HelpSubcommand extends SubCommand {
  override async run(ctx: CommandContext) {
    const text = [
      "📖 **Bot Access & Permissions Guide**",
      "",
      "**Available Scopes (for `/access grant`):**",
      "• `all` — Full access to all bot features and commands.",
      "• `memory` — Player memory & data management (e.g., `/forget`).",
      "• `config` — Bot & server configuration.",
      "• `chat` — AI chat interaction & limit bypasses.",
      "",
      "**Access Hierarchy:**",
      "1. **Bot Developers** (in `DEVELOPER_IDS`): Bypass all server restrictions.",
      "2. **Server Owner & Admins** (Discord `Administrator`): Have full access to all commands in this server.",
      "3. **Roles with Scopes**: Granted via `/access grant role: @Role scope: <scope>` to allow non-admins to use specific commands.",
      "4. **Public**: Commands without restrictions can be run by anyone.",
      "",
      "*(To restrict custom commands in code, add `props: { access: '<scope>' }` to their `@Declare` definition).* ",
    ].join("\n");

    await ctx.write({
      content: text,
      flags: MessageFlags.Ephemeral,
    });
  }
}
