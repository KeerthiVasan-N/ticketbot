"use strict";

/**
 * Browser lifecycle manager.
 * Handles launching, attaching to, and gracefully closing the persistent
 * Chromium context used by both the ticket bot and the WhatsApp helper.
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { USER_DATA_DIR, BROWSER_ARGS, FEATURES } = require("./config");
const { createLogger } = require("./logger");

chromium.use(StealthPlugin());

const log = createLogger("Browser");

let _context = null;

/**
 * Launch (or reuse) the persistent browser context.
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext() {
  if (_context) return _context;

  log.info(`Launching persistent context from: ${USER_DATA_DIR}`);
  _context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: BROWSER_ARGS,
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });

  _context.on("close", () => {
    log.warn("Browser context closed.");
    _context = null;
  });

  log.info("Browser context ready.");
  return _context;
}

/**
 * Open a new page in the shared context.
 * @param {string} [url]  Optional URL to navigate to after opening.
 * @returns {Promise<import('playwright').Page>}
 */
async function newPage(url) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  return page;
}

/**
 * Close the browser context gracefully.
 */
async function closeContext() {
  if (!_context) return;
  try {
    await _context.close();
  } catch (err) {
    log.error(`Error closing context: ${err.message}`);
  } finally {
    _context = null;
  }
}

/**
 * Get all open pages in the current context.
 * @returns {import('playwright').Page[]}
 */
function getPages() {
  if (!_context) return [];
  return _context.pages();
}

/**
 * Close all pages except the given one.
 * @param {import('playwright').Page} keepPage
 */
async function closeOtherPages(keepPage) {
  const pages = getPages();
  for (const p of pages) {
    if (p !== keepPage) {
      try {
        await p.close();
      } catch (_) {}
    }
  }
}

module.exports = {
  getContext,
  newPage,
  closeContext,
  getPages,
  closeOtherPages,
};
