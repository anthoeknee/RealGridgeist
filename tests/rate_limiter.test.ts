import { describe, expect, it, beforeEach } from "bun:test";
import {
  SlidingWindowRateLimiter,
  DEFAULT_RATE_LIMIT,
  DEFAULT_WINDOW_MS,
} from "../src/chat/rateLimiter";

describe("Sliding Window Rate Limiter (src/chat/rateLimiter.ts)", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    // Instantiate with autoCleanup disabled to prevent lingering background intervals in test runner
    limiter = new SlidingWindowRateLimiter({
      limit: 5,
      windowMs: 30_000,
      autoCleanup: false,
    });
  });

  describe("Defaults & Configuration", () => {
    it("uses default values of 5 requests per 30 seconds", () => {
      const defaultLimiter = new SlidingWindowRateLimiter({ autoCleanup: false });
      expect(defaultLimiter.limit).toBe(DEFAULT_RATE_LIMIT);
      expect(defaultLimiter.limit).toBe(5);
      expect(defaultLimiter.windowMs).toBe(DEFAULT_WINDOW_MS);
      expect(defaultLimiter.windowMs).toBe(30_000);
    });

    it("accepts custom limits and window sizes", () => {
      const custom = new SlidingWindowRateLimiter({
        limit: 10,
        windowMs: 60_000,
        autoCleanup: false,
      });
      expect(custom.limit).toBe(10);
      expect(custom.windowMs).toBe(60_000);
    });
  });

  describe("Request Consumption & Sliding Window Tracking", () => {
    it("allows up to 5 requests within the 30-second window", () => {
      const baseTime = 1_000_000;
      const userId = "user-alice";

      expect(limiter.consume(userId, baseTime)).toBe(true);
      expect(limiter.getRemaining(userId, baseTime)).toBe(4);

      expect(limiter.consume(userId, baseTime + 1_000)).toBe(true);
      expect(limiter.getRemaining(userId, baseTime + 1_000)).toBe(3);

      expect(limiter.consume(userId, baseTime + 2_000)).toBe(true);
      expect(limiter.getRemaining(userId, baseTime + 2_000)).toBe(2);

      expect(limiter.consume(userId, baseTime + 3_000)).toBe(true);
      expect(limiter.getRemaining(userId, baseTime + 3_000)).toBe(1);

      expect(limiter.consume(userId, baseTime + 4_000)).toBe(true);
      expect(limiter.getRemaining(userId, baseTime + 4_000)).toBe(0);
    });

    it("rejects the 6th request within the 30-second window", () => {
      const baseTime = 1_000_000;
      const userId = "user-alice";

      for (let i = 0; i < 5; i++) {
        expect(limiter.consume(userId, baseTime + i * 500)).toBe(true);
      }

      // 6th attempt should be blocked
      const blocked = limiter.consume(userId, baseTime + 3_000);
      expect(blocked).toBe(false);
      expect(limiter.getRemaining(userId, baseTime + 3_000)).toBe(0);
      expect(limiter.getRetryAfter(userId, baseTime + 3_000)).toBeGreaterThan(0);
    });

    it("isRateLimited helper returns true when limit is exceeded", () => {
      const baseTime = 1_000_000;
      const userId = "user-bob";

      // 5 allowed requests (isRateLimited returns false because request was accepted)
      for (let i = 0; i < 5; i++) {
        expect(limiter.isRateLimited(userId, baseTime + i * 100)).toBe(false);
      }

      // 6th request returns true (user is rate limited)
      expect(limiter.isRateLimited(userId, baseTime + 1_000)).toBe(true);
    });

    it("allows new requests once the sliding window has elapsed", () => {
      const baseTime = 1_000_000;
      const userId = "user-charlie";

      // Exhaust all 5 tokens at baseTime
      for (let i = 0; i < 5; i++) {
        expect(limiter.consume(userId, baseTime)).toBe(true);
      }
      expect(limiter.consume(userId, baseTime + 5_000)).toBe(false);

      // Advance time by 30,001 ms (just past the 30s window)
      const futureTime = baseTime + 30_001;
      expect(limiter.consume(userId, futureTime)).toBe(true);
      expect(limiter.getRemaining(userId, futureTime)).toBe(4);
    });

    it("correctly calculates rolling expiration per individual timestamp", () => {
      const baseTime = 100_000;
      const userId = "user-rolling";

      // Request 1 at t = 0s
      limiter.consume(userId, baseTime);
      // Request 2 at t = 10s
      limiter.consume(userId, baseTime + 10_000);
      // Request 3 at t = 20s
      limiter.consume(userId, baseTime + 20_000);
      // Request 4 at t = 25s
      limiter.consume(userId, baseTime + 25_000);
      // Request 5 at t = 28s
      limiter.consume(userId, baseTime + 28_000);

      // Now at t = 29s, all 5 tokens are used
      expect(limiter.consume(userId, baseTime + 29_000)).toBe(false);

      // At t = 30.5s: Request 1 (t=0s) has expired! Exactly 1 token freed up
      const checkAt30_5s = limiter.check(userId, baseTime + 30_500);
      expect(checkAt30_5s.allowed).toBe(true);
      expect(checkAt30_5s.remaining).toBe(1);

      // Consume that freed token
      expect(limiter.consume(userId, baseTime + 30_500)).toBe(true);
      // Immediately after, user is capped again
      expect(limiter.consume(userId, baseTime + 30_600)).toBe(false);

      // At t = 40.5s: Request 2 (t=10s) expires, freeing up another slot
      expect(limiter.consume(userId, baseTime + 40_500)).toBe(true);
    });
  });

  describe("User Isolation", () => {
    it("maintains isolated rate limits across different users", () => {
      const baseTime = 500_000;
      const userA = "user-a";
      const userB = "user-b";

      // Exhaust User A's limit
      for (let i = 0; i < 5; i++) {
        expect(limiter.consume(userA, baseTime)).toBe(true);
      }
      expect(limiter.consume(userA, baseTime)).toBe(false);

      // User B should be completely unaffected
      expect(limiter.getRemaining(userB, baseTime)).toBe(5);
      expect(limiter.consume(userB, baseTime)).toBe(true);
      expect(limiter.getRemaining(userB, baseTime)).toBe(4);
    });
  });

  describe("Inspection & Reset APIs", () => {
    it("check() does not consume quota (idempotent inspection)", () => {
      const baseTime = 500_000;
      const userId = "user-inspector";

      const before = limiter.check(userId, baseTime);
      expect(before.allowed).toBe(true);
      expect(before.remaining).toBe(5);
      expect(before.retryAfterMs).toBe(0);

      // Calling check multiple times does not alter remaining count
      limiter.check(userId, baseTime);
      limiter.check(userId, baseTime);
      expect(limiter.getRemaining(userId, baseTime)).toBe(5);
    });

    it("reset(userId) clears a single user's limit", () => {
      const baseTime = 500_000;
      const user1 = "user-1";
      const user2 = "user-2";

      limiter.consume(user1, baseTime);
      limiter.consume(user2, baseTime);

      limiter.reset(user1);
      expect(limiter.getRemaining(user1, baseTime)).toBe(5);
      expect(limiter.getRemaining(user2, baseTime)).toBe(4);
    });

    it("clear() resets all tracked users", () => {
      const baseTime = 500_000;
      limiter.consume("user-1", baseTime);
      limiter.consume("user-2", baseTime);

      expect(limiter.getTrackedUserCount()).toBe(2);
      limiter.clear();
      expect(limiter.getTrackedUserCount()).toBe(0);
    });

    it("pruneExpired() purges users whose windows have fully lapsed", () => {
      const baseTime = 100_000;
      limiter.consume("user-active", baseTime + 20_000);
      limiter.consume("user-expired", baseTime);

      expect(limiter.getTrackedUserCount()).toBe(2);

      // Prune at baseTime + 35_000 (35s later: user-expired is >30s old, user-active is 15s old)
      const pruned = limiter.pruneExpired(baseTime + 35_000);
      expect(pruned).toBe(1);
      expect(limiter.getTrackedUserCount()).toBe(1);
    });
  });
});
