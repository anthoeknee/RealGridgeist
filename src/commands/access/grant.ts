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
    description: "The server role to grant permissions to",
    required: true,
  }),
  scope: createStringOption({
    description: "The bot feature scope to grant",
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
  name: "grant",
  description: "Grant a bot feature permission (scope) to a server role",
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
        content: `✅ Granted **\`${scope}\`** permission to <@&${role.id}>.\nMembers with this role can now use commands requiring this scope.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ctx.write({
        content: `ℹ️ Role <@&${role.id}> already has the **\`${scope}\`** permission scope.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
