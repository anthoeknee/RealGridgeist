import { createMiddleware } from "seyfert";
import { checkAccess, type AccessLevel } from "../permissions";

declare module "seyfert" {
  interface ExtraProps {
    access?: AccessLevel;
  }
}

export const permissions = createMiddleware<void>(async ({ context, next, stop }) => {
  const access = (context.command?.props?.access as AccessLevel | undefined) ?? "public";

  const guild = context.guildId ? await context.guild().catch(() => null) : null;
  const isOwner = guild ? guild.ownerId === context.author.id : false;
  let isAdmin = false;

  try {
    if (context.member?.permissions?.has) {
      isAdmin =
        context.member.permissions.has(["Administrator"]) ||
        context.member.permissions.has("Administrator");
    }
  } catch {
    isAdmin = false;
  }

  const roles = context.member?.roles?.keys ? Array.from(context.member.roles.keys) : [];

  const result = checkAccess(
    {
      userId: context.author.id,
      guildId: context.guildId,
      isOwner,
      isAdmin,
      roles,
    },
    access,
  );

  if (!result.allowed) {
    return stop(result.reason ?? "You do not have permission to use this command.");
  }

  next();
});

export default permissions;
