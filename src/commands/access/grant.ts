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
    description: "The server role to grant access to",
    required: true,
  }),
  scope: createStringOption({
    description: "The permission scope to grant",
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
  name: "grant",
  description: "Grant a permission scope to a role",
  props: { access: "admin" },
})
@Options(options)
export default class GrantSubcommand extends SubCommand {
  override async run(ctx: CommandContext<typeof options>) {
    if (!ctx.guildId) {
      await ctx.write({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { role, scope } = ctx.options;
    const added = permissionRepo.grant(ctx.guildId, role.id, scope);

    if (added) {
      await ctx.write({
        content: `✅ Granted permission scope \`${scope}\` to role <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ctx.write({
        content: `ℹ️ Role <@&${role.id}> already has the \`${scope}\` permission scope.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
