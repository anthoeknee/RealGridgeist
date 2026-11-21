import { Declare, SubCommand, type CommandContext } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { permissionRepo } from "../../permissions";

@Declare({
  name: "list",
  description: "List all configured role permission scopes for this server",
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
        content: "📋 No role permission scopes are configured for this server.",
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

    const lines = ["🛡️ **Configured Role Permission Scopes:**"];
    for (const [roleId, scopes] of byRole.entries()) {
      lines.push(`• <@&${roleId}>: ${scopes.map((s) => `\`${s}\``).join(", ")}`);
    }

    await ctx.write({
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
