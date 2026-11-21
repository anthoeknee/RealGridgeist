import { describe, it, expect, mock } from "bun:test";
import PresenceCommand from "../../src/commands/presence";
import { ActivityType, PresenceUpdateStatus } from "seyfert";
import { env } from "../../src/env";

describe("PresenceCommand", () => {
  const currentOwnerId = env.BOT_OWNER_ID ?? env.OWNER_ID ?? env.resolvedOwnerId ?? "test_owner_id";

  it("rejects unauthorized users who are not the bot owner", async () => {
    const cmd = new PresenceCommand();
    const mockSetPresence = mock(() => Promise.resolve());
    const mockWrite = mock(() => Promise.resolve());

    const mockCtx: any = {
      author: { id: "unauthorized_user_123" },
      options: {
        activity: "playing",
        message: "Grid Runner",
      },
      client: {
        gateway: { setPresence: mockSetPresence },
        logger: { error: mock() },
      },
      write: mockWrite,
    };

    await cmd.run(mockCtx);

    expect(mockSetPresence).toHaveBeenCalledTimes(0);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0].content).toContain("Only the bot owner can use this command");
  });

  it("updates presence when invoked by the bot owner", async () => {
    const cmd = new PresenceCommand();
    const mockSetPresence = mock(() => Promise.resolve());
    const mockWrite = mock(() => Promise.resolve());

    const mockCtx: any = {
      author: { id: currentOwnerId },
      options: {
        activity: "playing",
        message: "Grid Runner",
        status: PresenceUpdateStatus.Online,
      },
      client: {
        gateway: {
          setPresence: mockSetPresence,
        },
        logger: {
          error: mock(),
        },
      },
      write: mockWrite,
    };

    await cmd.run(mockCtx);

    expect(mockSetPresence).toHaveBeenCalledTimes(1);
    const presenceArg = mockSetPresence.mock.calls[0][0];
    expect(presenceArg.status).toBe(PresenceUpdateStatus.Online);
    expect(presenceArg.activities[0]).toEqual({
      name: "Grid Runner",
      type: ActivityType.Playing,
    });
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0].content).toContain("Bot presence updated successfully!");
  });

  it("handles streaming activity with custom stream URL", async () => {
    const cmd = new PresenceCommand();
    const mockSetPresence = mock(() => Promise.resolve());
    const mockWrite = mock(() => Promise.resolve());

    const mockCtx: any = {
      author: { id: currentOwnerId },
      options: {
        activity: "streaming",
        message: "Championship Finals",
        status: PresenceUpdateStatus.DoNotDisturb,
        stream_url: "https://twitch.tv/mychannel",
      },
      client: {
        gateway: {
          setPresence: mockSetPresence,
        },
        logger: {
          error: mock(),
        },
      },
      write: mockWrite,
    };

    await cmd.run(mockCtx);

    expect(mockSetPresence).toHaveBeenCalledTimes(1);
    const presenceArg = mockSetPresence.mock.calls[0][0];
    expect(presenceArg.activities[0]).toEqual({
      name: "Championship Finals",
      type: ActivityType.Streaming,
      url: "https://twitch.tv/mychannel",
    });
  });

  it("handles mobile flag by setting browser properties", async () => {
    const cmd = new PresenceCommand();
    const mockSetPresence = mock(() => Promise.resolve());
    const mockWrite = mock(() => Promise.resolve());

    const gatewayObj: any = {
      setPresence: mockSetPresence,
      options: {
        properties: {
          $browser: "Seyfert",
        },
      },
    };

    const mockCtx: any = {
      author: { id: currentOwnerId },
      options: {
        activity: "custom",
        message: "AFK on phone",
        mobile: true,
      },
      client: {
        gateway: gatewayObj,
        logger: {
          error: mock(),
        },
      },
      write: mockWrite,
    };

    await cmd.run(mockCtx);

    expect(gatewayObj.options.properties.$browser).toBe("Discord Android");
    expect(mockSetPresence).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][0].content).toContain("Mobile Indicator: **Enabled**");
  });
});
