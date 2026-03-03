import { runForThread, runForAllThreads, runForThreadNoView } from "../bot-runner.js";
import { configManager } from "../config-manager.js";
import { sendReelUrlToThread } from "../reel-sender.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  threadId?: string;
  reelUrl?: string;
  noView?: boolean;
}

export async function handleSendNow(args: Args): Promise<ToolResult> {
  try {
    const creds = configManager.getCredentials();
    if (!creds) {
      return errorResult(
        "No Instagram credentials configured. Call instagram_bot_set_credentials first."
      );
    }

    if (args.threadId) {
      const thread = configManager.getThread(args.threadId);
      if (!thread) {
        return errorResult(`Thread "${args.threadId}" not found.`);
      }
      if (!thread.enabled) {
        return errorResult(
          `Thread "${args.threadId}" is disabled. Enable it with instagram_bot_configure_thread.`
        );
      }
      if (args.reelUrl) {
        const sent = await sendReelUrlToThread(thread.threadName, args.reelUrl);
        return successResult({
          results: [
            {
              threadId: thread.threadId,
              sent: sent ? 1 : 0,
              skipped: 0,
              errors: sent ? [] : [`Failed to send reel: ${args.reelUrl}`],
            },
          ],
        });
      }

      const result = args.noView
        ? await runForThreadNoView(thread)
        : await runForThread(thread);
      return successResult({ results: [result] });
    } else {
      if (args.reelUrl) {
        return errorResult("threadId is required when reelUrl is provided.");
      }

      const results = await runForAllThreads();
      const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
      return successResult({ results, totalSent });
    }
  } catch (err) {
    return errorResult(
      `Send failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
