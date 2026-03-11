import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = path.join(__dirname, "../.instagram-session/cookies.json");
const NEW_CAPTION = "Beautiful sunset 🌅 #sunset #sky #nature #photography #goldenhour";
const POST_URL = "https://www.instagram.com/mananb/p/DVfptEXFbdd8L1xfyWokpXI0D2L2JkbCuNgppA0/";

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
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

  await page.goto(POST_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);

  // Click "..." More options
  log("Clicking More options...");
  await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-label="More options"]'));
    for (const svg of svgs) {
      let node = svg;
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") {
          node.click(); return;
        }
      }
    }
  });
  await sleep(2000);

  // Click Edit
  log("Clicking Edit...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button'], div[role='menuitem']"));
    const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
    if (edit) edit.click();
  });
  await sleep(2500);
  await page.screenshot({ path: "/tmp/paste-edit-open.png" });

  // Set caption using clipboard paste (handles emoji correctly)
  log("Setting caption via clipboard paste...");
  
  // Write caption to clipboard via xdotool or pbcopy (macOS)
  const { execSync } = await import("child_process");
  execSync(`echo '${NEW_CAPTION.replace(/'/g, "'\\''")}' | pbcopy`);
  
  // Find and click the textarea
  await page.click("textarea");
  await sleep(500);
  
  // Select all existing text and delete
  await page.keyboard.down("Meta");
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await sleep(200);
  await page.keyboard.press("Backspace");
  await sleep(200);

  // Paste from clipboard
  await page.keyboard.down("Meta");
  await page.keyboard.press("v");
  await page.keyboard.up("Meta");
  await sleep(1000);
  
  await page.screenshot({ path: "/tmp/paste-caption-typed.png" });
  
  // Check what's in the textarea
  const captionValue = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    return ta ? ta.value : "no textarea";
  });
  log("Caption in textarea: " + captionValue);

  // Click Save/Done
  log("Clicking Save...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const save = btns.find(b => (b.textContent.trim() === "Done" || b.textContent.trim() === "Save") && b.offsetParent !== null);
    if (save) save.click();
  });
  await sleep(4000);
  await page.screenshot({ path: "/tmp/paste-saved.png" });

  // Verify
  const postText = await page.evaluate(() => document.body.innerText.substring(0, 400));
  log("Post text after save: " + postText.substring(0, 200));

  await sleep(3000);
  await browser.close();
  log("Done!");
})();
