import { configManager } from "../config-manager.js";
import { isSchedulerRunning, getCurrentExpression } from "../scheduler.js";
import { successResult, type ToolResult } from "../types.js";

export async function handleGetStatus(): Promise<ToolResult> {
  const creds = configManager.getCredentials();
  const threads = configManager.getThreads();
  const categories = configManager.getCategories();
  const history = configManager.getAllHistory();
  const today = new Date().toISOString().split("T")[0];

  const threadStatus = threads.map((t) => {
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

  return successResult({
    credentialsConfigured: creds !== null,
    username: creds?.username ?? null,
    cronExpression: getCurrentExpression(),
    schedulerCurrentlyRunning: isSchedulerRunning(),
    categoriesCount: categories.length,
    categories: categories.map((c) => ({
      name: c.name,
      description: c.description ?? null,
      hashtagCount: c.hashtags.length,
      hashtags: c.hashtags,
    })),
    threadsCount: threads.length,
    threads: threadStatus,
    timestamp: new Date().toISOString(),
  });
}
