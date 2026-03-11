/**
 * manual-login-riseclub9.mjs
 * Opens Instagram login in a visible browser window.
 * Log in as riseclub9 (including 2FA if prompted).
 * Cookies are saved to .instagram-session/cookies-riseclub9.json on success.
 *
 * Usage: node scripts/manual-login-riseclub9.mjs
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "../.instagram-session");
const COOKIE_FILE = path.join(SESSION_DIR, "cookies-riseclub9.json");

fs.mkdirSync(SESSION_DIR, { recursive: true });

console.log("Opening browser for riseclub9 login...");
console.log("Log in manually in the browser that opens (complete 2FA if prompted).");
console.log("Cookies will be saved automatically once you reach the home feed.\n");

const browser = await puppeteer.launch({
  headless: false,
  args: [
    "--start-maximized",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
  ],
  defaultViewport: null,
});

const page = await browser.newPage();
await page.setUserAgent(
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
);

await page.goto("https://www.instagram.com/accounts/login/", {
  waitUntil: "networkidle2",
  timeout: 30000,
});

// Poll every 2s for up to 10 minutes for successful navigation away from login
for (let i = 0; i < 300; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const url = page.url();

  if (
    !url.includes("/accounts/login") &&
    !url.includes("two_factor") &&
    !url.includes("challenge") &&
    url.includes("instagram.com")
  ) {
    console.log(`\nDetected successful login! URL: ${url}`);
    // Wait a moment for session cookies to fully settle
    await new Promise(r => setTimeout(r, 3000));
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log(`\n✅ SUCCESS: Saved ${cookies.length} cookies to:`);
    console.log(`   ${COOKIE_FILE}`);
    console.log("\nYou can now start the reel generator daemon.");
    await browser.close();
    process.exit(0);
  }

  if (i % 15 === 0 && i > 0) {
    console.log(`[${Math.round(i * 2 / 60)}min] Waiting for login... (current URL: ${url})`);
  }
}

console.log("\nTIMEOUT: Login not completed within 10 minutes.");
await browser.close();
process.exit(1);
