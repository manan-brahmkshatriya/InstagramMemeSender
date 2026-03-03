import { configManager } from "../config-manager.js";
import { instagramBrowser } from "../instagram-browser.js";
import { successResult, errorResult, type ToolResult } from "../types.js";

interface Args {
  username: string;
  password: string;
}

export async function handleSetCredentials(args: Args): Promise<ToolResult> {
  try {
    if (!args.username || !args.password) {
      return errorResult("Both username and password are required.");
    }
    configManager.setCredentials(args.username.trim(), args.password);
    // Invalidate cached login state so next operation re-authenticates
    instagramBrowser.invalidateLoginState();
    return successResult({
      success: true,
      message: `Credentials saved for @${args.username.trim()}. Use instagram_bot_send_now to test login.`,
    });
  } catch (err) {
    return errorResult(
      `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
