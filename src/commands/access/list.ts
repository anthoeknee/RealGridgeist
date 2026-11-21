import { Declare, SubCommand, type CommandContext } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { permissionRepo } from "../../permissions";

@Declare({
  name: "list",
  description: "View all role permissions configured for this server",
  props: { access: "admin" },
})
export default class ListSubcommand extends SubCommand {
  override async run(ctx: CommandContext) {
    if (!ctx.guildId) {
      await ctx.write({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const records = permissionRepo.listGuild(ctx.guildId);

    if (records.length === 0) {
      await ctx.write({
        content:
          "📋 **No custom role permissions are set for this server.**\n\nBy default, Server Administrators, the Server Owner, and Bot Developers have access to all commands.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const byRole = new Map<string, string[]>();
    for (const r of records) {
      const list = byRole.get(r.role_id) ?? [];
      list.push(r.scope);
      byRole.set(r.role_id, list);
    }

    const lines = [
      "🛡️ **Configured Role Permissions:**",
      "",
      ...Array.from(byRole.entries()).map(
        ([roleId, scopes]) => `• <@&${roleId}>: ${scopes.map((s) => `\`${s}\``).join(", ")}`,
      ),
      "",
      "💡 *Server Administrators, the Server Owner, and Bot Developers automatically have access to all commands.*",
    ];

    await ctx.write({
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
