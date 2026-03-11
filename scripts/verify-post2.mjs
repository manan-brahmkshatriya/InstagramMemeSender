import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  await page.goto("https://www.instagram.com/mananb/p/DVfptEXFbdd8L1xfyWokpXI0D2L2JkbCuNgppA0/", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);

  // Zoom in on the right side panel (caption area)
  await page.screenshot({ path: "/tmp/post-caption-zoom.png", clip: { x: 680, y: 0, width: 600, height: 400 } });

  // Also get all text on the page
  const allText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log("Page text:", allText);
  
  await browser.close();
})();
