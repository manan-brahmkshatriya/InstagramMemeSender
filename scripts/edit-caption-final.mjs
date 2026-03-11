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

  // Open "..." menu
  await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg[aria-label="More options"]'));
    for (const svg of svgs) {
      let node = svg;
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") { node.click(); return; }
      }
    }
  });
  await sleep(2000);

  // Click Edit
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button'], div[role='menuitem']"));
    const edit = btns.find(b => b.textContent.trim() === "Edit" && b.offsetParent !== null);
    if (edit) edit.click();
  });
  await sleep(2500);

  // Target the caption contenteditable div
  log("Setting caption on contenteditable div...");
  const result = await page.evaluate((caption) => {
    // The caption field is a contenteditable div
    const captionDiv = document.querySelector('div[aria-label="Write a caption..."]') ||
                       document.querySelector('div[aria-label="Write a caption…"]') ||
                       document.querySelector('div[contenteditable="true"]');
    
    if (!captionDiv) return "not found";

    // Focus the element
    captionDiv.focus();
    
    // Clear existing content
    captionDiv.innerHTML = '';
    
    // Use execCommand to insert text (works with React)
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, caption);
    
    return "set: " + captionDiv.textContent.substring(0, 60);
  }, NEW_CAPTION);
  log("Caption result: " + result);
  await sleep(1500);
  
  await page.screenshot({ path: "/tmp/final-caption-set.png" });

  // Verify caption text is there
  const captionText = await page.evaluate(() => {
    const el = document.querySelector('div[aria-label="Write a caption..."]') || document.querySelector('div[contenteditable="true"]');
    return el?.textContent || "empty";
  });
  log("Caption text in div: " + captionText.substring(0, 80));

  // Click Save
  log("Clicking Save...");
  const saved = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, div[role='button']"));
    const save = btns.find(b => (b.textContent.trim() === "Done" || b.textContent.trim() === "Save") && b.offsetParent !== null);
    if (save) { save.click(); return save.textContent.trim(); }
    return "not found";
  });
  log("Save result: " + saved);
  
  // Wait for save to complete
  await sleep(5000);
  await page.screenshot({ path: "/tmp/final-caption-saved.png" });

  // Verify on the post page
  const finalCaption = await page.evaluate(() => {
    // Caption appears as the first span/div after the username in the post
    const article = document.querySelector("article");
    if (!article) return "no article";
    return article.innerText.substring(0, 200);
  });
  log("Post content after save: " + finalCaption);

  await sleep(3000);
  await browser.close();
  log("DONE");
})();
