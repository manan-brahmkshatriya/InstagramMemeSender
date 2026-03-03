import { startMcpServer } from "./mcp-server.js";
import { startScheduler } from "./scheduler.js";
import { startHttpApi } from "./http-api.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  log("instagram-bot: starting...");

  // Start cron scheduler (non-blocking)
  startScheduler();
  log("instagram-bot: scheduler started");

  // Start local HTTP API for companion apps
  startHttpApi();
  log("instagram-bot: HTTP API started");

  // Start MCP server (blocking — holds process open)
  await startMcpServer();
  log("instagram-bot: startMcpServer() returned");
}

main().catch((err: unknown) => {
  process.stderr.write(`instagram-bot: Fatal error: ${err}\n`);
  process.exit(1);
});
