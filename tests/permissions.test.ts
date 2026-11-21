import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../src/memory/db";
import { PermissionRepository } from "../src/permissions/repo";
import {
  BOT_SCOPES,
  checkAccess,
  hasAccess,
  isDeveloper,
  type AccessLevel,
  type PermissionSubject,
} from "../src/permissions";
import { env } from "../src/env";
import { SlidingWindowRateLimiter } from "../src/chat/rateLimiter";

describe("Permission Repository (PermissionRepository)", () => {
  let db: Database;
  let repo: PermissionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PermissionRepository(db);
  });

  it("grants and lists scopes for a guild", () => {
    expect(repo.grant("guild-1", "role-1", "memory")).toBe(true);
    // Duplicate grant returns false due to ON CONFLICT DO NOTHING
    expect(repo.grant("guild-1", "role-1", "memory")).toBe(false);

    expect(repo.grant("guild-1", "role-2", "config")).toBe(true);
    expect(repo.grant("guild-2", "role-3", "chat")).toBe(true);

    const guild1Scopes = repo.listGuild("guild-1");
    expect(guild1Scopes.length).toBe(2);
    expect(guild1Scopes).toEqual([
      { guild_id: "guild-1", role_id: "role-1", scope: "memory" },
      { guild_id: "guild-1", role_id: "role-2", scope: "config" },
    ]);

    const guild2Scopes = repo.listGuild("guild-2");
    expect(guild2Scopes.length).toBe(1);
    expect(guild2Scopes[0].scope).toBe("chat");
  });

  it("revokes scopes from a role in a guild", () => {
    repo.grant("guild-1", "role-1", "memory");
    repo.grant("guild-1", "role-1", "config");

    expect(repo.revoke("guild-1", "role-1", "memory")).toBe(true);
    // Already revoked
    expect(repo.revoke("guild-1", "role-1", "memory")).toBe(false);

    const remaining = repo.listGuild("guild-1");
    expect(remaining.length).toBe(1);
    expect(remaining[0].scope).toBe("config");
  });

  it("evaluates hasAnyScope with exact match and 'all' wildcard", () => {
    repo.grant("guild-1", "role-mod", "memory");
    repo.grant("guild-1", "role-lead", "all");

    // Empty roles returns false immediately
    expect(repo.hasAnyScope("guild-1", [], "memory")).toBe(false);

    // Unrelated role returns false
    expect(repo.hasAnyScope("guild-1", ["role-user"], "memory")).toBe(false);

    // Exact match
    expect(repo.hasAnyScope("guild-1", ["role-mod"], "memory")).toBe(true);
    expect(repo.hasAnyScope("guild-1", ["role-mod"], "config")).toBe(false);

    // Wildcard 'all' matches any scope
    expect(repo.hasAnyScope("guild-1", ["role-lead"], "memory")).toBe(true);
    expect(repo.hasAnyScope("guild-1", ["role-lead"], "config")).toBe(true);
    expect(repo.hasAnyScope("guild-1", ["role-lead"], "chat")).toBe(true);

    // Multiple roles where one matches
    expect(repo.hasAnyScope("guild-1", ["role-user", "role-mod"], "memory")).toBe(true);
    expect(repo.hasAnyScope("guild-1", ["role-user", "role-lead"], "chat")).toBe(true);

    // Scopes are isolated across guilds
    expect(repo.hasAnyScope("guild-other", ["role-mod"], "memory")).toBe(false);
  });
});

describe("Core Permission Logic (checkAccess & isDeveloper)", () => {
  const devId = "dev-user-999";
  const regularId = "reg-user-111";

  beforeEach(() => {
    // Inject developer ID into env.DEVELOPER_IDS for testing
    env.DEVELOPER_IDS.add(devId);
  });

  it("verifies isDeveloper", () => {
    expect(isDeveloper(devId)).toBe(true);
    expect(isDeveloper(regularId)).toBe(false);
    expect(isDeveloper(undefined)).toBe(false);
    expect(isDeveloper(null)).toBe(false);
    expect(isDeveloper("")).toBe(false);
  });

  it("rule 1: Developers always pass any access level anywhere", () => {
    const devSubject: PermissionSubject = { userId: devId };

    for (const level of ["public", "dev", "admin", "memory", "config", "chat"] as AccessLevel[]) {
      const res = checkAccess(devSubject, level);
      expect(res.allowed).toBe(true);
      expect(hasAccess(devSubject, level)).toBe(true);
    }

    // Developer passes even in DM without guild
    expect(checkAccess({ userId: devId, guildId: null }, "admin").allowed).toBe(true);
  });

  it("rule 2: 'public' always passes for any user", () => {
    const regularSubject: PermissionSubject = { userId: regularId };
    expect(checkAccess(regularSubject, "public").allowed).toBe(true);
    expect(checkAccess({ userId: regularId, guildId: null }, "public").allowed).toBe(true);
  });

  it("rule 3: 'dev' fails for non-developers, even guild owners/admins", () => {
    const adminSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-1",
      isAdmin: true,
      isOwner: true,
    };

    const res = checkAccess(adminSubject, "dev");
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("restricted to bot developers");
  });

  it("rule 4: Anything else requires a guild", () => {
    const dmSubject: PermissionSubject = {
      userId: regularId,
      guildId: null,
    };

    const adminRes = checkAccess(dmSubject, "admin");
    expect(adminRes.allowed).toBe(false);
    expect(adminRes.reason).toContain("only be used in a server");

    const scopeRes = checkAccess(dmSubject, "memory");
    expect(scopeRes.allowed).toBe(false);
    expect(scopeRes.reason).toContain("only be used in a server");
  });

  it("rule 5: Guild owner or Discord Administrator always passes server-level checks", () => {
    const ownerSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-1",
      isOwner: true,
      isAdmin: false,
    };

    const adminSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-1",
      isOwner: false,
      isAdmin: true,
    };

    for (const subject of [ownerSubject, adminSubject]) {
      expect(checkAccess(subject, "admin").allowed).toBe(true);
      expect(checkAccess(subject, "memory").allowed).toBe(true);
      expect(checkAccess(subject, "config").allowed).toBe(true);
      expect(checkAccess(subject, "chat").allowed).toBe(true);
    }
  });

  it("rule 6: 'admin' fails for non-admins", () => {
    const memberSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-1",
      isOwner: false,
      isAdmin: false,
      roles: ["role-1"],
    };

    const res = checkAccess(memberSubject, "admin");
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("requires server administrator permissions");
  });

  it("rule 7: Scopes pass if member's role has scope or 'all' in permissionRepo", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    const customRepo = new PermissionRepository(testDb);

    // Save and swap repo in permissionRepo
    const { permissionRepo } = require("../src/permissions");
    permissionRepo.setDatabase(testDb);

    customRepo.grant("guild-test", "role-analyst", "memory");
    customRepo.grant("guild-test", "role-super", "all");

    const analystSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-test",
      roles: ["role-analyst"],
    };

    expect(checkAccess(analystSubject, "memory").allowed).toBe(true);

    const deniedConfig = checkAccess(analystSubject, "config");
    expect(deniedConfig.allowed).toBe(false);
    expect(deniedConfig.reason).toContain("'config' permission scope");

    const superSubject: PermissionSubject = {
      userId: regularId,
      guildId: "guild-test",
      roles: ["role-super"],
    };
    expect(checkAccess(superSubject, "memory").allowed).toBe(true);
    expect(checkAccess(superSubject, "config").allowed).toBe(true);
    expect(checkAccess(superSubject, "chat").allowed).toBe(true);
  });

  it("parses subject from Seyfert CommandContext shape", () => {
    const mockCtx = {
      author: { id: regularId },
      guildId: "guild-mock",
      guild: { ownerId: regularId },
      member: {
        permissions: {
          has: (perm: string | string[]) => false,
        },
        roles: {
          keys: ["role-1", "role-2"],
        },
      },
    };

    // Owner should pass
    expect(checkAccess(mockCtx, "admin").allowed).toBe(true);
  });
});

describe("Rate Limiter Developer Bypass", () => {
  const devId = "dev-speed-runner";
  const regularId = "reg-slow-poke";

  beforeEach(() => {
    env.DEVELOPER_IDS.add(devId);
  });

  it("allows developers to bypass rate limits indefinitely", () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 10_000, autoCleanup: false });

    // Regular user exhausts limit
    expect(limiter.consume(regularId)).toBe(true);
    expect(limiter.consume(regularId)).toBe(true);
    expect(limiter.consume(regularId)).toBe(false);
    expect(limiter.isRateLimited(regularId)).toBe(true);
    expect(limiter.check(regularId).allowed).toBe(false);

    // Developer never gets blocked
    for (let i = 0; i < 20; i++) {
      expect(limiter.consume(devId)).toBe(true);
      expect(limiter.isRateLimited(devId)).toBe(false);
      expect(limiter.check(devId).allowed).toBe(true);
    }
  });
});
