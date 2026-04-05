"use strict";

/**
 * ticketbot — monitor.js
 *
 * Usage:
 *   node monitor.js
 *
 *   1. Browser opens. A floating "TicketBot" panel appears top-right.
 *   2. Hover over any element — it gets a red outline (picker mode).
 *   3. Click the element you want to monitor — it's now MARKED.
 *   4. Click "Start Monitoring" in the panel to begin 50 ms polling.
 *   5. The moment that element is visible again, it is clicked automatically.
 */

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

// ─── Config ───────────────────────────────────────────────────────────────────
const TARGET_URL = "https://district.in/events/ipl-ticket-booking";
const POLL_MS = 50;
const RELOAD_MS = 30_000;
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder — wire your Baileys / whatsapp-web.js client here.
 *   Baileys:         await sock.sendMessage('<num>@s.whatsapp.net', { text: message });
 *   whatsapp-web.js: await client.sendMessage('<num>@c.us', message);
 */
async function sendWhatsAppAlert(message) {
  console.log("[WhatsApp placeholder]", message);
}

function ts() {
  return new Date().toISOString();
}

// ─── Picker UI injected into the live page ────────────────────────────────────
// This string runs inside the BROWSER tab (not Node), so no require() allowed.
const PICKER_SCRIPT = `
(function () {
  if (document.getElementById('__tb_panel')) return;

  // ── Styles ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = \`
    .__tb_hover  { outline: 3px solid #e94560 !important; cursor: crosshair !important; }
    .__tb_marked { outline: 3px solid #00e676 !important; }
    #__tb_panel  {
      position:fixed; top:14px; right:14px; z-index:2147483647;
      background:#1a1a2e; color:#eee; border-radius:10px;
      padding:14px 18px; font-family:monospace; font-size:13px;
      box-shadow:0 4px 24px rgba(0,0,0,.75); min-width:240px; user-select:none;
    }
    #__tb_titlebar {
      display:flex; align-items:center; justify-content:space-between;
      margin-bottom:8px; cursor:grab;
    }
    #__tb_titlebar:active { cursor:grabbing; }
    #__tb_titlebar h3 { margin:0; color:#e94560; font-size:15px; }
    #__tb_info     { margin-bottom:10px; color:#a8e6cf; font-size:12px; line-height:1.6; }
    #__tb_unmark   {
      background:none; border:1px solid #555; color:#aaa; border-radius:5px;
      padding:3px 8px; font-size:11px; cursor:pointer; margin-bottom:8px; width:100%;
    }
    #__tb_unmark:hover { border-color:#e94560; color:#e94560; }
    #__tb_start    {
      background:#e94560; color:#fff; border:none; border-radius:6px;
      padding:9px 0; cursor:pointer; font-size:13px; width:100%; font-weight:bold;
    }
    #__tb_start:hover:not(:disabled) { background:#c73652; }
    #__tb_start:disabled { background:#444; color:#777; cursor:default; }
    #__tb_cancel {
      background:none; border:1px solid #e94560; color:#e94560; border-radius:6px;
      padding:7px 0; cursor:pointer; font-size:13px; width:100%; font-weight:bold; margin-top:6px;
    }
    #__tb_cancel:hover { background:#e94560; color:#fff; }
  \`;
  document.head.appendChild(style);

  // ── Panel ────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = '__tb_panel';
  panel.innerHTML = \`
    <div id="__tb_titlebar"><h3>🎯 TicketBot</h3><span style="color:#555;font-size:11px">⠿ drag</span></div>
    <div id="__tb_info">Hover &amp; <b>click</b> the button<br>you want to monitor</div>
    <button id="__tb_unmark" style="display:none">✕ Unmark</button>
    <button id="__tb_start" disabled>Start Monitoring</button>
    <button id="__tb_cancel" style="display:none">⏹ Cancel Monitoring</button>
  \`;
  document.body.appendChild(panel);

  const info      = document.getElementById('__tb_info');
  const btn       = document.getElementById('__tb_start');
  const unmarkBtn = document.getElementById('__tb_unmark');
  const cancelBtn = document.getElementById('__tb_cancel');
  const titlebar  = document.getElementById('__tb_titlebar');

  // ── Drag to move ─────────────────────────────────────────────────────────
  let dragOffX = 0, dragOffY = 0, dragging = false;
  titlebar.addEventListener('mousedown', function (e) {
    dragging = true;
    const r = panel.getBoundingClientRect();
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    panel.style.right = 'auto';
    panel.style.left  = (e.clientX - dragOffX) + 'px';
    panel.style.top   = (e.clientY - dragOffY) + 'px';
  });
  document.addEventListener('mouseup', function () { dragging = false; });

  // ── CSS-selector generator (runs in browser) ─────────────────────────────
  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.tagName && cur.tagName !== 'HTML') {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let s = cur.tagName.toLowerCase();
      const sibs = Array.from(cur.parentNode ? cur.parentNode.children : [])
                        .filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      parts.unshift(s);
      cur = cur.parentNode;
    }
    return parts.join(' > ');
  }

  let markedEl = null;

  // ── Hover highlight ──────────────────────────────────────────────────────
  document.addEventListener('mouseover', function (e) {
    if (panel.contains(e.target)) return;
    document.querySelectorAll('.__tb_hover').forEach(function (el) {
      el.classList.remove('__tb_hover');
    });
    if (e.target !== markedEl) e.target.classList.add('__tb_hover');
  }, true);

  // ── Click → mark ─────────────────────────────────────────────────────────
  let monitoring = false; // locked once Start Monitoring is clicked
  document.addEventListener('click', function (e) {
    if (panel.contains(e.target)) return;
    if (monitoring) return; // ignore page clicks while monitoring
    e.preventDefault();
    e.stopImmediatePropagation();

    // Clear previous mark
    if (markedEl) markedEl.classList.remove('__tb_marked');

    markedEl = e.target;
    markedEl.classList.remove('__tb_hover');
    markedEl.classList.add('__tb_marked');

    const selector = getSelector(e.target);
    const text = (e.target.innerText || e.target.textContent || '').trim().slice(0, 40);
    info.innerHTML = '✓ Marked:<br><b>"' + text + '"</b>';
    btn.disabled = false;
    unmarkBtn.style.display = 'block';
    window.__tb_mark({ selector: selector, text: text });
  }, true);

  // ── Unmark button ─────────────────────────────────────────────────────────
  unmarkBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (markedEl) { markedEl.classList.remove('__tb_marked'); markedEl = null; }
    monitoring = false;
    info.innerHTML = 'Hover &amp; <b>click</b> the button<br>you want to monitor';
    btn.disabled = true;
    unmarkBtn.style.display = 'none';
    window.__tb_unmark();
  });

  // ── Start button ──────────────────────────────────────────────────────────
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    monitoring = true;
    info.innerHTML = '▶ Monitoring…';
    btn.disabled = true;
    unmarkBtn.style.display = 'none';
    cancelBtn.style.display = 'block';
    // Remove all hover/marked outlines now that we are locked in
    document.querySelectorAll('.__tb_hover, .__tb_marked').forEach(function(el) {
      el.classList.remove('__tb_hover', '__tb_marked');
    });
    window.__tb_start();
  });

  // ── Cancel button ────────────────────────────────────────────────────────
  cancelBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    monitoring = false;
    markedEl = null;
    info.innerHTML = 'Hover &amp; <b>click</b> the button<br>you want to monitor';
    btn.disabled = true;
    cancelBtn.style.display = 'none';
    window.__tb_cancel();
  });
})();
`;

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  let markedSelector = null;
  let markedText = null;
  let intervalId = null;
  let clicked = false;
  let isChecking = false;
  let lastLoadTime = Date.now();

  // ── Expose Node callbacks to the browser tab ──────────────────────────────
  await page.exposeFunction("__tb_mark", ({ selector, text }) => {
    markedSelector = selector;
    markedText = text;
    console.log(`\n[${ts()}] Marked  : "${text}"`);
    console.log(`         Selector: ${selector}`);
    console.log('         Now click "Start Monitoring" in the panel.\n');
  });

  await page.exposeFunction("__tb_unmark", () => {
    markedSelector = null;
    markedText = null;
    console.log(`[${ts()}] Unmarked — pick a new element.`);
  });

  await page.exposeFunction("__tb_cancel", () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    clicked = false;
    isChecking = false;
    markedSelector = null;
    markedText = null;
    console.log(
      `[${ts()}] Monitoring CANCELLED — pick a new element to start again.`,
    );
  });

  await page.exposeFunction("__tb_start", () => {
    if (!markedSelector) {
      console.log(`[${ts()}] Nothing marked yet — click an element first.`);
      return;
    }
    // Clear any previous polling loop before starting a fresh one
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      clicked = false;
      isChecking = false;
      console.log(`[${ts()}] Previous polling stopped.`);
    }
    console.log(
      `[${ts()}] Polling started for "${markedText}" every ${POLL_MS} ms`,
    );
    startPolling();
  });

  // ── Polling loop ──────────────────────────────────────────────────────────
  function startPolling() {
    async function poll() {
      if (clicked || isChecking) return;
      isChecking = true;
      try {
        const locator = page.locator(markedSelector);
        const visible = await locator
          .first()
          .isVisible()
          .catch(() => false);

        if (visible) {
          clicked = true;
          clearInterval(intervalId);
          const stamp = ts();
          console.log(`[${stamp}] CLICKED: "${markedText}"`);
          await locator.first().click({ timeout: 5_000 });
          await sendWhatsAppAlert(`"${markedText}" clicked at ${stamp}`);
          return;
        }

        if (Date.now() - lastLoadTime > RELOAD_MS) {
          console.log(`[${ts()}] Not found for 30 s — reloading page…`);
          await loadPage();
        }
      } catch (err) {
        console.error(`[${ts()}] Poll error: ${err.message}`);
      } finally {
        isChecking = false;
      }
    }
    intervalId = setInterval(poll, POLL_MS);
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  async function loadPage() {
    lastLoadTime = Date.now();
    console.log(`[${ts()}] Navigating to ${TARGET_URL} …`);
    try {
      await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      console.log(`[${ts()}] Page loaded.`);
    } catch (err) {
      console.error(`[${ts()}] Navigation error: ${err.message}`);
    }
  }

  async function injectUI() {
    try {
      await page.evaluate(PICKER_SCRIPT);
    } catch (_) {
      /* navigating */
    }
  }

  // Re-inject after every navigation (SPA route changes or reloads)
  page.on("load", () => injectUI());
  page.on("crash", async () => {
    isChecking = false;
    await loadPage();
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  console.log(`[${ts()}] Launching browser…`);
  console.log(
    "  Step 1 — Hover over the button you want to watch (red outline).",
  );
  console.log("  Step 2 — Click it to mark it.");
  console.log('  Step 3 — Click "Start Monitoring" in the floating panel.\n');

  await loadPage();
  await injectUI();
}

main().catch(console.error);
