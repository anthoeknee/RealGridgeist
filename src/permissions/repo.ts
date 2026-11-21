import { Database, Statement } from "bun:sqlite";
import { getDatabase } from "../memory/db";

export interface RoleScopeRow {
  guild_id: string;
  role_id: string;
  scope: string;
}

export class PermissionRepository {
  private db: Database;
  private stmtGrant!: Statement;
  private stmtRevoke!: Statement;
  private stmtListGuild!: Statement;

  constructor(database?: Database) {
    this.db = database ?? getDatabase();
    this.initStatements();
  }

  public setDatabase(database: Database): void {
    this.db = database;
    this.initStatements();
  }

  private initStatements(): void {
    this.stmtGrant = this.db.prepare(`
      INSERT INTO role_scopes (guild_id, role_id, scope)
      VALUES ($guild_id, $role_id, $scope)
      ON CONFLICT(guild_id, role_id, scope) DO NOTHING;
    `);

    this.stmtRevoke = this.db.prepare(`
      DELETE FROM role_scopes
      WHERE guild_id = $guild_id AND role_id = $role_id AND scope = $scope;
    `);

    this.stmtListGuild = this.db.prepare(`
      SELECT guild_id, role_id, scope
      FROM role_scopes
      WHERE guild_id = $guild_id
      ORDER BY role_id ASC, scope ASC;
    `);
  }

  /**
   * Grants a permission scope to a role within a guild.
   * Returns true if newly inserted, false if already present.
   */
  public grant(guildId: string, roleId: string, scope: string): boolean {
    const res = this.stmtGrant.run({
      $guild_id: guildId,
      $role_id: roleId,
      $scope: scope,
    });
    return res.changes > 0;
  }

  /**
   * Revokes a permission scope from a role within a guild.
   * Returns true if deleted, false if not found.
   */
  public revoke(guildId: string, roleId: string, scope: string): boolean {
    const res = this.stmtRevoke.run({
      $guild_id: guildId,
      $role_id: roleId,
      $scope: scope,
    });
    return res.changes > 0;
  }

  /**
   * Lists all role scopes configured for a guild.
   */
  public listGuild(guildId: string): RoleScopeRow[] {
    return this.stmtListGuild.all({
      $guild_id: guildId,
    }) as RoleScopeRow[];
  }

  /**
   * Checks if any of the given roleIds has the requested scope or the 'all' wildcard scope.
   */
  public hasAnyScope(guildId: string, roleIds: string[], scope: string): boolean {
    if (!roleIds || roleIds.length === 0) {
      return false;
    }

    const placeholders = roleIds.map(() => "?").join(", ");
    const stmt = this.db.prepare(`
      SELECT 1 FROM role_scopes
      WHERE guild_id = ?
        AND role_id IN (${placeholders})
        AND (scope = ? OR scope = 'all')
      LIMIT 1;
    `);

    const row = stmt.get(guildId, ...roleIds, scope);
    return row !== null;
  }
}

export const permissionRepo = new PermissionRepository();
