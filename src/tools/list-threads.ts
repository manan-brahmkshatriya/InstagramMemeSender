import { configManager } from "../config-manager.js";
import { successResult, type ToolResult } from "../types.js";

export async function handleListThreads(): Promise<ToolResult> {
  const threads = configManager.getThreads();
  const history = configManager.getAllHistory();
  const today = new Date().toISOString().split("T")[0];

  const enriched = threads.map((t) => {
    const h = history.threads[t.threadId];
    const todayCount = h?.dailyCountDate === today ? h.dailyCount : 0;
    return {
      threadId: t.threadId,
      threadName: t.threadName,
      enabled: t.enabled,
      categories: t.categories,
      dailyLimit: t.dailyLimit,
      todayCount,
      remaining: t.dailyLimit - todayCount,
      lifetimeSentCount: h?.sentReelUrls.length ?? 0,
      lastSentAt: h?.lastSentAt ?? null,
    };
  });

  return successResult({ threads: enriched, count: threads.length });
}
