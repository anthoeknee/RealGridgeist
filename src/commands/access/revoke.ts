import {
  Declare,
  SubCommand,
  Options,
  createRoleOption,
  createStringOption,
  type CommandContext,
} from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { permissionRepo } from "../../permissions";

const options = {
  role: createRoleOption({
    description: "The server role to revoke access from",
    required: true,
  }),
  scope: createStringOption({
    description: "The permission scope to revoke",
    required: true,
    choices: [
      { name: "all (*)", value: "all" },
      { name: "memory", value: "memory" },
      { name: "config", value: "config" },
      { name: "chat", value: "chat" },
    ] as const,
  }),
};

@Declare({
  name: "revoke",
  description: "Revoke a permission scope from a role",
  props: { access: "admin" },
})
@Options(options)
export default class RevokeSubcommand extends SubCommand {
  override async run(ctx: CommandContext<typeof options>) {
    if (!ctx.guildId) {
      await ctx.write({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { role, scope } = ctx.options;
    const removed = permissionRepo.revoke(ctx.guildId, role.id, scope);

    if (removed) {
      await ctx.write({
        content: `✅ Revoked permission scope \`${scope}\` from role <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ctx.write({
        content: `ℹ️ Role <@&${role.id}> does not have the \`${scope}\` permission scope.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
