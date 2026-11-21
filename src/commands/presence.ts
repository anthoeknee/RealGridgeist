import {
  Command,
  Declare,
  Options,
  createStringOption,
  createBooleanOption,
  ActivityType,
  PresenceUpdateStatus,
  type CommandContext,
} from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { env } from "../env";

const ACTIVITY_MAP = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  streaming: ActivityType.Streaming,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
} as const;

type ActivityChoice = keyof typeof ACTIVITY_MAP;

const options = {
  activity: createStringOption({
    description: "The activity type for the bot",
    required: true,
    choices: [
      { name: "Playing", value: "playing" },
      { name: "Listening", value: "listening" },
      { name: "Watching", value: "watching" },
      { name: "Streaming", value: "streaming" },
      { name: "Competing", value: "competing" },
      { name: "Custom", value: "custom" },
    ] as const,
  }),
  message: createStringOption({
    description: "The status or activity message text",
    required: true,
  }),
  status: createStringOption({
    description: "Online status indicator",
    required: false,
    choices: [
      { name: "Online", value: PresenceUpdateStatus.Online },
      { name: "Idle", value: PresenceUpdateStatus.Idle },
      { name: "Do Not Disturb (dnd)", value: PresenceUpdateStatus.DoNotDisturb },
      { name: "Invisible", value: PresenceUpdateStatus.Invisible },
    ] as const,
  }),
  mobile: createBooleanOption({
    description: "Whether to display as mobile device indicator",
    required: false,
  }),
  stream_url: createStringOption({
    description: "Twitch / YouTube stream URL (required if streaming)",
    required: false,
  }),
};

@Declare({
  name: "presence",
  description: "Modify the bot presence, status, activity, and mobile indicator (bot owner only)",
  props: { access: "dev" },
})
@Options(options)
export default class PresenceCommand extends Command {
  override async run(ctx: CommandContext<typeof options>) {
    const ownerId = env.BOT_OWNER_ID ?? env.OWNER_ID ?? env.resolvedOwnerId;
    if (!ownerId || ctx.author.id !== ownerId) {
      await ctx.write({
        content: "⛔ Only the bot owner can use this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { activity, message, status, mobile, stream_url } = ctx.options;

    const activityType = ACTIVITY_MAP[activity as ActivityChoice] ?? ActivityType.Playing;
    const presenceStatus = (status as PresenceUpdateStatus) ?? PresenceUpdateStatus.Online;

    // Discord streaming activity requires a valid streaming URL
    const streamUrl = activityType === ActivityType.Streaming ? (stream_url ?? "https://twitch.tv/discord") : undefined;

    try {
      // If mobile toggle is provided, adjust gateway identification browser property
      if (mobile !== undefined && ctx.client.gateway) {
        const browserProp = mobile ? "Discord Android" : "Seyfert";
        // Update ShardManager properties so any new identify / reconnect maintains mobile status
        if ((ctx.client.gateway as any).options?.properties) {
          (ctx.client.gateway as any).options.properties.$browser = browserProp;
          (ctx.client.gateway as any).options.properties.browser = browserProp;
        }
      }

      const presenceData = {
        since: null,
        afk: false,
        status: presenceStatus,
        activities: [
          {
            name: message,
            type: activityType,
            ...(activityType === ActivityType.Custom ? { state: message } : {}),
            ...(streamUrl ? { url: streamUrl } : {}),
          },
        ],
      };

      // Set presence across shards
      if (ctx.client.gateway) {
        if (typeof (ctx.client.gateway as any).setPresence === "function") {
          await (ctx.client.gateway as any).setPresence(presenceData);
        } else if (typeof (ctx.client.gateway as any).send === "function") {
          // Opcode 3: Gateway Opcode for Presence Update
          await (ctx.client.gateway as any).send({
            op: 3,
            d: presenceData,
          });
        }
      }

      const mobileText = mobile !== undefined ? `\n📱 Mobile Indicator: **${mobile ? "Enabled" : "Disabled"}**` : "";
      const streamText = streamUrl ? `\n🔗 Stream URL: \`${streamUrl}\`` : "";

      await ctx.write({
        content: `✅ Bot presence updated successfully!\n` +
          `🎮 **Type**: \`${activity.toUpperCase()}\`\n` +
          `💬 **Message**: ${message}\n` +
          `🟢 **Status**: \`${presenceStatus}\`` +
          mobileText +
          streamText,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      ctx.client.logger.error("Failed to update presence:", error);
      await ctx.write({
        content: `❌ Failed to update presence: ${error instanceof Error ? error.message : String(error)}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
