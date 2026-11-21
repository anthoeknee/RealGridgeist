import { isDeveloper } from "../permissions";

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  autoCleanup?: boolean;
  cleanupIntervalMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  resetMs: number;
}

export const DEFAULT_RATE_LIMIT = 5;
export const DEFAULT_WINDOW_MS = 30_000; // 30 seconds in ms
export const DEFAULT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute

/**
 * Sliding Window Rate Limiter.
 * Tracks per-user request timestamps over a moving window of time (default: 5 requests per 30 seconds).
 */
export class SlidingWindowRateLimiter {
  public readonly limit: number;
  public readonly windowMs: number;
  public readonly cleanupIntervalMs: number;
  private readonly userTimestamps: Map<string, number[]>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limit ?? DEFAULT_RATE_LIMIT;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.userTimestamps = new Map<string, number[]>();

    if (options.autoCleanup !== false) {
      this.startCleanupTimer();
    }
  }

  /**
   * Starts background timer to periodically prune inactive user timestamp records.
   */
  public startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.pruneExpired();
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer?.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stops background cleanup timer.
   */
  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Prunes records older than windowMs across all tracked users.
   */
  public pruneExpired(now: number = Date.now()): number {
    let prunedUsers = 0;
    const windowStart = now - this.windowMs;

    for (const [userId, timestamps] of this.userTimestamps.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.userTimestamps.delete(userId);
        prunedUsers++;
      } else if (valid.length < timestamps.length) {
        this.userTimestamps.set(userId, valid);
      }
    }

    return prunedUsers;
  }

  /**
   * Cleans expired timestamps for a specific user and returns the current valid timestamps.
   */
  private getValidTimestamps(userId: string, now: number): number[] {
    const timestamps = this.userTimestamps.get(userId);
    if (!timestamps || timestamps.length === 0) {
      return [];
    }

    const windowStart = now - this.windowMs;
    const valid = timestamps.filter((t) => t > windowStart);

    if (valid.length === 0) {
      this.userTimestamps.delete(userId);
      return [];
    }

    if (valid.length < timestamps.length) {
      this.userTimestamps.set(userId, valid);
    }

    return valid;
  }

  /**
   * Checks the user's current rate limit status without recording a request.
   */
  public check(userId: string, now: number = Date.now()): RateLimitResult {
    if (isDeveloper(userId)) {
      return {
        allowed: true,
        remaining: this.limit,
        retryAfterMs: 0,
        resetMs: 0,
      };
    }

    const valid = this.getValidTimestamps(userId, now);
    const count = valid.length;
    const allowed = count < this.limit;
    const remaining = Math.max(0, this.limit - count);

    let retryAfterMs = 0;
    let resetMs = 0;

    if (count > 0 && valid[0] !== undefined) {
      const oldestTimestamp = valid[0];
      const expiry = oldestTimestamp + this.windowMs;
      resetMs = Math.max(0, expiry - now);
      if (!allowed) {
        retryAfterMs = resetMs;
      }
    }

    return {
      allowed,
      remaining,
      retryAfterMs,
      resetMs,
    };
  }

  /**
   * Consumes one request slot if permitted.
   * Returns true if request is allowed, false if rate limited.
   */
  public consume(userId: string, now: number = Date.now()): boolean {
    if (isDeveloper(userId)) {
      return true;
    }

    const valid = this.getValidTimestamps(userId, now);

    if (valid.length >= this.limit) {
      return false;
    }

    valid.push(now);
    this.userTimestamps.set(userId, valid);
    return true;
  }

  /**
   * Alias for consume: attempts to acquire a request token.
   */
  public tryAcquire(userId: string, now: number = Date.now()): boolean {
    return this.consume(userId, now);
  }

  /**
   * Evaluates if user has exceeded the rate limit.
   * If not limited, consumes a token and returns false.
   * If limited, returns true.
   */
  public isRateLimited(userId: string, now: number = Date.now()): boolean {
    return !this.consume(userId, now);
  }

  /**
   * Returns remaining requests allowed within the current window for the user.
   */
  public getRemaining(userId: string, now: number = Date.now()): number {
    return this.check(userId, now).remaining;
  }

  /**
   * Returns milliseconds until the user can make another request (0 if not limited).
   */
  public getRetryAfter(userId: string, now: number = Date.now()): number {
    return this.check(userId, now).retryAfterMs;
  }

  /**
   * Resets rate limit tracking for a specific user, or all users if userId is omitted.
   */
  public reset(userId?: string): void {
    if (userId) {
      this.userTimestamps.delete(userId);
    } else {
      this.userTimestamps.clear();
    }
  }

  /**
   * Clears all tracked users and timestamps.
   */
  public clear(): void {
    this.reset();
  }

  /**
   * Returns the number of currently tracked users.
   */
  public getTrackedUserCount(): number {
    return this.userTimestamps.size;
  }
}

// Global default rate limiter singleton
export const chatRateLimiter = new SlidingWindowRateLimiter();
export const defaultRateLimiter = chatRateLimiter;
