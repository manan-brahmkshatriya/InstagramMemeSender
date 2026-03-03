import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { log } from "./logger.js";
import { handleSetCredentials } from "./tools/set-credentials.js";
import { handleSetSchedule } from "./tools/set-schedule.js";
import { handleAddCategory } from "./tools/add-category.js";
import { handleListCategories } from "./tools/list-categories.js";
import { handleConfigureThread } from "./tools/configure-thread.js";
import { handleRemoveThread } from "./tools/remove-thread.js";
import { handleListThreads } from "./tools/list-threads.js";
import { handleSendNow } from "./tools/send-now.js";
import { handleGetStatus } from "./tools/get-status.js";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "instagram-bot",
    version: "1.0.0",
  });

  server.registerTool(
    "instagram_bot_set_credentials",
    {
      title: "Set Instagram Credentials",
      description:
        "Save your Instagram username and password. The bot logs in once and persists the session via cookies. " +
        "Call instagram_bot_get_status or instagram_bot_send_now afterward to verify login works.",
      inputSchema: z.object({
        username: z.string().describe("Your Instagram username (without @)"),
        password: z.string().describe("Your Instagram password"),
      }),
    },
    async (args) => handleSetCredentials(args)
  );

  server.registerTool(
    "instagram_bot_set_schedule",
    {
      title: "Set Posting Schedule",
      description:
        "Configure the cron expression controlling when reels are auto-sent to all enabled threads. " +
        "Default is '0 9,18 * * *' (9 AM and 6 PM daily). Takes effect immediately.",
      inputSchema: z.object({
        cronExpression: z
          .string()
          .describe(
            "Standard 5-field cron expression, e.g. '0 9,18 * * *' for 9 AM and 6 PM daily, " +
            "'0 10 * * *' for 10 AM daily"
          ),
      }),
    },
    async (args) => handleSetSchedule(args)
  );

  server.registerTool(
    "instagram_bot_add_category",
    {
      title: "Add Reel Category",
      description:
        "Add or update a reel category with Instagram hashtags to scrape. " +
        "Categories are subscribed to by threads. Example: name='funny', hashtags=['funny', 'funnyvideos'].",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Unique category slug, e.g. 'veg-protein' or 'funny'"),
        hashtags: z
          .array(z.string())
          .describe(
            "Instagram hashtags to scrape (with or without # prefix). " +
            "e.g. ['vegetarianprotein', 'indianfood', '#highprotein']"
          ),
        description: z
          .string()
          .optional()
          .describe("Optional human-readable description of this category"),
      }),
    },
    async (args) => handleAddCategory(args)
  );

  server.registerTool(
    "instagram_bot_list_categories",
    {
      title: "List Reel Categories",
      description: "List all configured reel categories and their hashtags.",
      inputSchema: z.object({}),
    },
    async () => handleListCategories()
  );

  server.registerTool(
    "instagram_bot_configure_thread",
    {
      title: "Configure Instagram Thread",
      description:
        "Add or update a target Instagram DM group or thread to send reels to. " +
        "The threadName must exactly match the display name shown in your Instagram DM inbox. " +
        "All referenced categories must already exist (create with instagram_bot_add_category).",
      inputSchema: z.object({
        threadId: z
          .string()
          .describe(
            "Unique stable slug for this thread config, e.g. 'family-group' or 'gym-friends'. " +
            "This is your internal identifier — it does not need to match the Instagram name."
          ),
        threadName: z
          .string()
          .describe(
            "Display name of the Instagram group/DM as shown in your inbox, e.g. 'Family Group'. " +
            "The bot will search for this name when sending reels."
          ),
        categories: z
          .array(z.string())
          .describe(
            "Category names to source reels from. Must already exist via instagram_bot_add_category."
          ),
        dailyLimit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .describe("Maximum reels to send to this thread per day (1-50). Resets at midnight."),
        enabled: z
          .boolean()
          .optional()
          .describe("Whether this thread is active (default: true). Set false to pause without removing."),
      }),
    },
    async (args) => handleConfigureThread(args)
  );

  server.registerTool(
    "instagram_bot_remove_thread",
    {
      title: "Remove Instagram Thread",
      description:
        "Remove a configured Instagram thread from the bot. Does not affect send history (deduplication is preserved).",
      inputSchema: z.object({
        threadId: z
          .string()
          .describe("The threadId slug to remove, e.g. 'family-group'"),
      }),
    },
    async (args) => handleRemoveThread(args)
  );

  server.registerTool(
    "instagram_bot_list_threads",
    {
      title: "List Configured Threads",
      description:
        "List all configured Instagram threads with their today's send count, " +
        "daily limit, remaining capacity, and lifetime stats.",
      inputSchema: z.object({}),
    },
    async () => handleListThreads()
  );

  server.registerTool(
    "instagram_bot_send_now",
    {
      title: "Send Reels Now",
      description:
        "Manually trigger reel sending immediately, respecting daily limits. " +
        "If threadId is provided, sends only to that thread. Omit threadId to send to all enabled threads. " +
        "Credentials must be set first with instagram_bot_set_credentials.",
      inputSchema: z.object({
        threadId: z
          .string()
          .optional()
          .describe(
            "Optional: specific thread slug to send to, e.g. 'family-group'. " +
            "Omit to send to all enabled threads."
          ),
        noView: z
          .boolean()
          .optional()
          .describe(
            "If true, collect reel URLs from hashtag pages only (no individual reel visits or downloads). " +
            "The reel is shared via Instagram's share modal. Faster and less traffic than the default flow."
          ),
      }),
    },
    async (args) => handleSendNow(args)
  );

  server.registerTool(
    "instagram_bot_get_status",
    {
      title: "Get Bot Status",
      description:
        "Get the current status of the Instagram bot: credentials, schedule, " +
        "per-thread today counts vs limits, and lifetime stats.",
      inputSchema: z.object({}),
    },
    async () => handleGetStatus()
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  server.connect(transport).then(() => {
    log("instagram-bot: MCP stdio transport closed");
  }).catch((err: unknown) => {
    log(`instagram-bot: MCP stdio error: ${err}`);
  });

  log("instagram-bot: MCP server connected via stdio transport");
}
