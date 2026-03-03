import { configManager } from "../config-manager.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  threadId: string;
}

export async function handleRemoveThread(args: Args): Promise<ToolResult> {
  try {
    const removed = configManager.removeThread(args.threadId);
    if (!removed) {
      return errorResult(`Thread "${args.threadId}" not found.`);
    }
    return successResult({ success: true, removed: args.threadId });
  } catch (err) {
    return errorResult(
      `Failed to remove thread: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
