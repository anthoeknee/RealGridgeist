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
    description: "The server role to revoke permissions from",
    required: true,
  }),
  scope: createStringOption({
    description: "The bot feature scope to revoke",
    required: true,
    choices: [
      { name: "all — All bot features (*)", value: "all" },
      { name: "memory — Player memory & data (/forget)", value: "memory" },
      { name: "config — Bot & server configuration", value: "config" },
      { name: "chat — AI chat & conversations", value: "chat" },
    ] as const,
  }),
};

@Declare({
  name: "revoke",
  description: "Revoke a bot feature permission (scope) from a server role",
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
        content: `✅ Revoked **\`${scope}\`** permission from role <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ctx.write({
        content: `ℹ️ Role <@&${role.id}> does not have the **\`${scope}\`** permission scope.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
