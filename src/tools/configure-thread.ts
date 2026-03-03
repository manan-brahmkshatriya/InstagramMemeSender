import { configManager } from "../config-manager.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  threadId: string;
  threadName: string;
  categories: string[];
  dailyLimit: number;
  enabled?: boolean;
}

export async function handleConfigureThread(args: Args): Promise<ToolResult> {
  try {
    if (!args.threadId || !args.threadId.trim()) {
      return errorResult("threadId is required.");
    }
    if (!args.threadName || !args.threadName.trim()) {
      return errorResult("threadName is required.");
    }
    if (!args.categories || args.categories.length === 0) {
      return errorResult("At least one category name must be provided.");
    }
    if (args.dailyLimit < 1 || args.dailyLimit > 50) {
      return errorResult("dailyLimit must be between 1 and 50.");
    }

    // Validate that all referenced categories exist
    const allCategories = configManager.getCategories();
    const missingCategories = args.categories.filter(
      (c) => !allCategories.some((cat) => cat.name === c)
    );
    if (missingCategories.length > 0) {
      return errorResult(
        `Unknown categories: ${missingCategories.join(", ")}. ` +
        `Add them first with instagram_bot_add_category.`
      );
    }

    configManager.upsertThread({
      threadId: args.threadId.trim(),
      threadName: args.threadName.trim(),
      categories: args.categories,
      dailyLimit: args.dailyLimit,
      enabled: args.enabled ?? true,
    });

    return successResult({
      success: true,
      threadId: args.threadId.trim(),
      threadName: args.threadName.trim(),
      categories: args.categories,
      dailyLimit: args.dailyLimit,
    });
  } catch (err) {
    return errorResult(
      `Failed to configure thread: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
