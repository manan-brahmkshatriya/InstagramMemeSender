import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "path";
import { PROJECT_ROOT } from "./types.js";
import { log, logError } from "./logger.js";
import { configManager } from "./config-manager.js";

// Absolute path for userDataDir — critical when spawned by Claude Desktop
// (CWD is NOT the project directory in that context — same lesson as wwebjs_cache)
const SESSION_DIR = path.join(PROJECT_ROOT, ".instagram-session");
const ACTIVE_SESSION_DIR = process.env.INSTAGRAM_SESSION_DIR
  ? path.resolve(process.env.INSTAGRAM_SESSION_DIR)
  : SESSION_DIR;
const FORCE_HEADLESS = process.env.INSTAGRAM_HEADLESS === "true";
const SLOW_MO_MS = Number(process.env.INSTAGRAM_SLOW_MO_MS ?? "0");

// Realistic Chrome on Mac user agent
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

class InstagramBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isLoggedIn = false;

  async launch(): Promise<void> {
    if (this.browser) return;
    log(
      `instagram-browser: launching Puppeteer (headless=${FORCE_HEADLESS}, session=${ACTIVE_SESSION_DIR})...`
    );

    this.browser = await puppeteer.launch({
      headless: FORCE_HEADLESS,
      userDataDir: ACTIVE_SESSION_DIR,
      slowMo: Number.isFinite(SLOW_MO_MS) && SLOW_MO_MS > 0 ? SLOW_MO_MS : 0,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--window-size=1366,768",
      ],
      defaultViewport: FORCE_HEADLESS ? { width: 1366, height: 768 } : null,
    });

    this.page = await this.browser.newPage();
    await this.page.setUserAgent(USER_AGENT);

    // Remove navigator.webdriver fingerprint
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    log("instagram-browser: browser launched");
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");
    return this.page;
  }

  /** Navigate to IG home and check if we're already logged in via persistent cookies. */
  async checkLoginState(): Promise<boolean> {
    try {
      const page = this.getPage();
      await page.goto("https://www.instagram.com/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      const url = page.url();
      if (url.includes("/accounts/login")) {
        log("instagram-browser: not logged in (redirected to login page)");
        this.isLoggedIn = false;
        return false;
      }

      // Check for DM inbox link — only present when logged in
      const loggedIn = (await page.$('a[href="/direct/inbox/"]')) !== null;
      this.isLoggedIn = loggedIn;
      log(`instagram-browser: login state check = ${loggedIn}`);
      return loggedIn;
    } catch (err) {
      logError("instagram-browser: checkLoginState failed", err);
      return false;
    }
  }

  /** Perform full username/password login. Handles post-login prompts. */
  async login(): Promise<boolean> {
    const creds = configManager.getCredentials();
    if (!creds) {
      log("instagram-browser: no credentials configured");
      return false;
    }

    try {
      const page = this.getPage();
      log(`instagram-browser: logging in as @${creds.username}`);

      await page.goto("https://www.instagram.com/accounts/login/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await this.randomDelay(1500, 2500);

      // Instagram login fields vary by rollout: username/password or email/pass
      const usernameSelector =
        (await page.$('input[name="username"]')) !== null
          ? 'input[name="username"]'
          : 'input[name="email"]';
      const passwordSelector =
        (await page.$('input[name="password"]')) !== null
          ? 'input[name="password"]'
          : 'input[name="pass"]';

      // Fill username
      await page.waitForSelector(usernameSelector, { timeout: 15000 });
      await page.click(usernameSelector);
      await this.randomDelay(300, 600);
      await page.type(usernameSelector, creds.username, { delay: 80 });
      await this.randomDelay(400, 800);

      // Fill password
      await page.click(passwordSelector);
      await this.randomDelay(300, 600);
      await page.type(passwordSelector, creds.password, { delay: 90 });
      await this.randomDelay(600, 1200);

      // Submit
      const submitBtn =
        (await page.$('button[type="submit"]')) ??
        (await page.$('input[type="submit"]'));
      if (!submitBtn) {
        throw new Error("Instagram login submit button not found.");
      }
      await submitBtn.click();

      // Wait for navigation away from login page
      try {
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
      } catch {
        // May not trigger cleanly on some IG versions
      }

      await this.randomDelay(2000, 3500);

      const url = page.url();
      if (url.includes("/accounts/login")) {
        log("instagram-browser: login failed — still on login page");
        this.isLoggedIn = false;
        return false;
      }

      // Dismiss "Save your login info?" and "Turn on notifications?" prompts
      try {
        const buttons = await page.$$("button");
        for (const btn of buttons) {
          const text = await page.evaluate((el) => el.textContent, btn);
          if (text?.toLowerCase().includes("not now")) {
            await btn.click();
            await this.randomDelay(1000, 2000);
            break;
          }
        }
      } catch {
        // Prompt may not appear
      }

      // Second prompt check (Turn on notifications)
      try {
        const buttons2 = await page.$$("button");
        for (const btn of buttons2) {
          const text = await page.evaluate((el) => el.textContent, btn);
          if (text?.toLowerCase().includes("not now")) {
            await btn.click();
            await this.randomDelay(1000, 1500);
            break;
          }
        }
      } catch {
        // Prompt may not appear
      }

      this.isLoggedIn = true;
      log("instagram-browser: login successful");
      return true;
    } catch (err) {
      logError("instagram-browser: login failed", err);
      this.isLoggedIn = false;
      return false;
    }
  }

  /**
   * Ensure browser is launched and logged in.
   * 3-tier: (a) cached flag → (b) live page check → (c) full login
   */
  async ensureLoggedIn(): Promise<void> {
    if (!this.browser) await this.launch();

    // Fast path: trust cached state
    if (this.isLoggedIn) return;

    // Medium path: check actual page state (handles session restore from userDataDir)
    const loggedIn = await this.checkLoginState();
    if (loggedIn) {
      this.isLoggedIn = true;
      return;
    }

    // Slow path: full login
    const success = await this.login();
    if (!success) {
      throw new Error(
        "Failed to log in to Instagram. Check credentials with instagram_bot_set_credentials."
      );
    }
  }

  /** Invalidate login cache — call after auth errors or credential changes. */
  invalidateLoginState(): void {
    this.isLoggedIn = false;
    log("instagram-browser: login state invalidated");
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      log("instagram-browser: browser closed");
    }
  }

  /** Random delay to mimic human behavior */
  async randomDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  static isSessionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("Target closed") ||
      msg.includes("Session closed") ||
      msg.includes("Protocol error") ||
      msg.includes("detached Frame") ||
      msg.includes("Navigation timeout")
    );
  }
}

export const instagramBrowser = new InstagramBrowser();
