"use strict";

/**
 * WhatsApp Web automation helpers.
 *
 * Provides higher-level functions for interacting with WhatsApp Web inside
 * the shared Playwright context — focused on the input box, message scanning,
 * and music-icon detection used by the game helper.
 */

const { WHATSAPP_CONFIG } = require("./config");
const { createLogger } = require("./logger");
const { sleep, normalizeText } = require("./utils");

const log = createLogger("WhatsApp");

// ── Selectors ───────────────────────────────────────────────────────────────
const INPUT_SEL = WHATSAPP_CONFIG.inputSelector;
const MUSIC_ICON_TEXT = "🎵";
const LENS_ICON_TEXT = "🔍";

// ── Input helpers ───────────────────────────────────────────────────────────

/**
 * Bring the WhatsApp page to front and focus the message input.
 * Returns true on success.
 * @param {import('playwright').Page} page
 */
async function focusInput(page) {
  try {
    await page.bringToFront();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.focus();
    }, INPUT_SEL);
    return true;
  } catch (err) {
    log.error(`focusInput failed: ${err.message}`);
    return false;
  }
}

/**
 * Type text into the WhatsApp input box via clipboard paste
 * for lossless unicode handling.
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {boolean} [send=false]  Press Enter after pasting.
 */
async function typeMessage(page, text, send = false) {
  const cleaned = normalizeText(text);
  if (!cleaned) return;

  await focusInput(page);
  await page.evaluate(async (t) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch (_) {}
  }, cleaned);

  await page.keyboard.press("Control+v");
  if (send) {
    await sleep(WHATSAPP_CONFIG.sendDelayMs);
    await page.keyboard.press("Enter");
  }
  log.debug(`Typed message (send=${send}): "${cleaned.slice(0, 60)}"`);
}

// ── Message scanning ─────────────────────────────────────────────────────────

/**
 * Extract text content of the most recent incoming message.
 * Returns null if nothing is found.
 * @param {import('playwright').Page} page
 */
async function getLastIncomingMessage(page) {
  try {
    return await page.evaluate(() => {
      const msgs = Array.from(
        document.querySelectorAll(
          '[data-testid="msg-container"] .copyable-text span[dir="ltr"]',
        ),
      );
      if (!msgs.length) return null;
      return msgs[msgs.length - 1].innerText.trim();
    });
  } catch {
    return null;
  }
}

/**
 * Scan visible messages for music (🎵) or lens (🔍) action icons injected
 * by WA_GAME_SCRIPT and return their descriptors.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{type:'music'|'lens', element: any, text: string}>>}
 */
async function scanActionIcons(page) {
  try {
    return await page.evaluate(
      ({ musicIcon, lensIcon }) => {
        const results = [];
        document.querySelectorAll(".tb-action-icon").forEach((el) => {
          const title = el.title || "";
          if (title.includes(musicIcon)) {
            results.push({ type: "music", text: el.dataset.query || "" });
          } else if (title.includes(lensIcon)) {
            results.push({ type: "lens", text: el.dataset.query || "" });
          }
        });
        return results;
      },
      { musicIcon: MUSIC_ICON_TEXT, lensIcon: LENS_ICON_TEXT },
    );
  } catch {
    return [];
  }
}

// ── Readiness check ──────────────────────────────────────────────────────────

/**
 * Wait for WhatsApp Web to finish loading (chat list visible).
 * @param {import('playwright').Page} page
 * @param {number} [timeoutMs=60_000]
 */
async function waitForReady(page, timeoutMs = 60_000) {
  log.info("Waiting for WhatsApp Web to load…");
  try {
    await page.waitForSelector('[data-testid="chat-list"]', {
      timeout: timeoutMs,
    });
    log.info("WhatsApp Web is ready.");
    return true;
  } catch {
    log.warn(
      "WhatsApp Web did not become ready in time — scan QR code if prompted.",
    );
    return false;
  }
}

module.exports = {
  focusInput,
  typeMessage,
  getLastIncomingMessage,
  scanActionIcons,
  waitForReady,
};
