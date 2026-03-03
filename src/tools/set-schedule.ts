import { updateSchedule } from "../scheduler.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  cronExpression: string;
}

export async function handleSetSchedule(args: Args): Promise<ToolResult> {
  try {
    const success = updateSchedule(args.cronExpression);
    if (!success) {
      return errorResult(
        `Invalid cron expression: "${args.cronExpression}". ` +
        `Use standard 5-field cron format, e.g. "0 9,18 * * *" for 9 AM and 6 PM daily.`
      );
    }
    return successResult({ success: true, cronExpression: args.cronExpression });
  } catch (err) {
    return errorResult(
      `Failed to set schedule: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
