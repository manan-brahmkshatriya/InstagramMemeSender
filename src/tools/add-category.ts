import { configManager } from "../config-manager.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  name: string;
  hashtags: string[];
  description?: string;
}

export async function handleAddCategory(args: Args): Promise<ToolResult> {
  try {
    if (!args.name || !args.name.trim()) {
      return errorResult("Category name is required.");
    }
    if (!args.hashtags || args.hashtags.length === 0) {
      return errorResult("At least one hashtag is required.");
    }

    // Strip leading # if users included it (e.g. "#funny" → "funny")
    const cleanHashtags = args.hashtags
      .map((h) => h.replace(/^#/, "").trim())
      .filter((h) => h.length > 0);

    if (cleanHashtags.length === 0) {
      return errorResult("All provided hashtags were empty after stripping # prefix.");
    }

    configManager.upsertCategory({
      name: args.name.trim(),
      hashtags: cleanHashtags,
      description: args.description,
    });

    return successResult({
      success: true,
      category: { name: args.name.trim(), hashtags: cleanHashtags },
    });
  } catch (err) {
    return errorResult(
      `Failed to add category: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
