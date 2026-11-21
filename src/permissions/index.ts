import { env } from "../env";
import { permissionRepo, PermissionRepository } from "./repo";

export const BOT_SCOPES = ["memory", "config", "chat"] as const;
export type BotScope = (typeof BOT_SCOPES)[number];
export type GrantableScope = BotScope | "all";
export type AccessLevel = "public" | "dev" | "admin" | BotScope;

export interface PermissionSubject {
  userId: string;
  guildId?: string | null;
  isOwner?: boolean;
  isAdmin?: boolean;
  roles?: string[];
}

export interface CheckAccessResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks whether a user ID belongs to the configured developer set.
 */
export function isDeveloper(userId?: string | null): boolean {
  if (!userId) return false;
  return env.DEVELOPER_IDS.has(userId);
}

/**
 * Evaluates access for a subject against a required access level.
 * Order of evaluation:
 * 1. Developers always pass.
 * 2. 'public' always passes.
 * 3. 'dev' fails for non-developers.
 * 4. Anything else requires a guild.
 * 5. Guild owner or Discord Administrator always passes.
 * 6. 'admin' fails for non-admins.
 * 7. Scopes pass if any of the member's roles has that scope or 'all' in permissionRepo.
 */
export function checkAccess(
  subject: PermissionSubject | any,
  required: AccessLevel = "public",
): CheckAccessResult {
  const userId = subject?.userId ?? subject?.author?.id ?? "";
  const guildId = subject?.guildId ?? null;
  const isOwner = Boolean(
    subject?.isOwner ??
      (subject?.guild && typeof subject?.guild === "object" && subject?.guild?.ownerId === userId),
  );
  const isAdmin = Boolean(
    subject?.isAdmin ??
      (subject?.member?.permissions?.has?.(["Administrator"]) ||
        subject?.member?.permissions?.has?.("Administrator")),
  );
  const roles: string[] = Array.isArray(subject?.roles)
    ? subject.roles
    : subject?.member?.roles?.keys
      ? Array.from(subject.member.roles.keys)
      : [];

  // 1. Developers always pass.
  if (isDeveloper(userId)) {
    return { allowed: true };
  }

  // 2. 'public' always passes.
  if (required === "public") {
    return { allowed: true };
  }

  // 3. 'dev' fails for non-developers.
  if (required === "dev") {
    return { allowed: false, reason: "This command is restricted to bot developers." };
  }

  // 4. Anything else requires a guild.
  if (!guildId) {
    return { allowed: false, reason: "This command can only be used in a server." };
  }

  // 5. Guild owner or Discord Administrator always passes.
  if (isOwner || isAdmin) {
    return { allowed: true };
  }

  // 6. 'admin' fails for non-admins.
  if (required === "admin") {
    return { allowed: false, reason: "This command requires server administrator permissions." };
  }

  // 7. Scopes pass if any of the member's roles has that scope or 'all' in permissionRepo.
  if (permissionRepo.hasAnyScope(guildId, roles, required)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `You do not have the required '${required}' permission scope to use this command.`,
  };
}

/**
 * Convenience helper returning boolean access status.
 */
export function hasAccess(subject: PermissionSubject | any, required: AccessLevel = "public"): boolean {
  return checkAccess(subject, required).allowed;
}

export { permissionRepo, PermissionRepository };
