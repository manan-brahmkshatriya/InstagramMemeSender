import puppeteer from "puppeteer";
import fs from "fs";

const SESSION_DIR = "/Users/mananbrahmkshatriya/Documents/InstagramBot/.instagram-session";
fs.mkdirSync(SESSION_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  defaultViewport: null,
});
const page = await browser.newPage();
await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle2", timeout: 30000 });

console.log("Browser open. Please log in manually and complete 2FA.");

// Poll every 2 seconds for up to 10 minutes
for (let i = 0; i < 300; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const url = page.url();
  if (!url.includes("/accounts/login") && !url.includes("two_factor") && url.includes("instagram.com")) {
    console.log("Logged in! URL:", url);
    await new Promise(r => setTimeout(r, 3000));
    const cookies = await page.cookies();
    fs.writeFileSync(`${SESSION_DIR}/cookies.json`, JSON.stringify(cookies, null, 2));
    console.log(`SUCCESS: saved ${cookies.length} cookies`);
    await browser.close();
    process.exit(0);
  }
}
console.log("TIMEOUT: Login not completed in 10 minutes.");
await browser.close();
process.exit(1);
