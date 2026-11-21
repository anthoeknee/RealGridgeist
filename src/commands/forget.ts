import { Command, Declare, type CommandContext } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { playerRepo } from "../memory/playerRepo";

@Declare({
  name: "forget",
  description: "Permanently delete your player profile and all remembered facts from memory",
})
export default class ForgetCommand extends Command {
  override async run(ctx: CommandContext) {
    const userId = ctx.author.id;
    const deleted = playerRepo.deletePlayer(userId);

    if (deleted) {
      await ctx.write({
        content: "🧹 All your remembered player data and dossier facts have been permanently deleted.",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await ctx.write({
        content: "ℹ️ You don't have any recorded dossier or facts stored in my memory.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
