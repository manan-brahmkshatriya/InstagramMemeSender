import { configManager } from "../config-manager.js";
import { successResult, type ToolResult } from "../types.js";

export async function handleListCategories(): Promise<ToolResult> {
  const categories = configManager.getCategories();
  return successResult({ categories, count: categories.length });
}
