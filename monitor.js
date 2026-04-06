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

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

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
      #__tb_pick {
      background:none; border:1px solid #7aa2ff; color:#7aa2ff; border-radius:6px;
      padding:8px 0; cursor:pointer; font-size:13px; width:100%; font-weight:bold; margin-bottom:6px;
    }
    #__tb_pick:hover { background:#7aa2ff; color:#111; }
    #__tb_pick.__tb_active { background:#7aa2ff; color:#111; }
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
    <div id="__tb_info">Browse normally.<br>Use <b>Pick Element</b> when ready.</div>
    <button id="__tb_unmark" style="display:none">✕ Unmark</button>
    <button id="__tb_pick">Pick Element</button>
    <button id="__tb_start" disabled>Start Monitoring</button>
    <button id="__tb_cancel" style="display:none">⏹ Cancel Monitoring</button>
  \`;
  document.body.appendChild(panel);

  const info      = document.getElementById('__tb_info');
  const btn       = document.getElementById('__tb_start');
  const unmarkBtn = document.getElementById('__tb_unmark');
  const pickBtn   = document.getElementById('__tb_pick');
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

  function buildDescriptor(el) {
    const text = (el.innerText || el.textContent || el.value || '').trim();
    const classes = Array.from(el.classList || []).slice(0, 6);
    const href = typeof el.getAttribute === 'function' ? (el.getAttribute('href') || '') : '';
    const ariaLabel = typeof el.getAttribute === 'function' ? (el.getAttribute('aria-label') || '') : '';
    const role = typeof el.getAttribute === 'function' ? (el.getAttribute('role') || '') : '';
    const type = typeof el.getAttribute === 'function' ? (el.getAttribute('type') || '') : '';
    return {
      selector: getSelector(el),
      text: text.slice(0, 200),
      tagName: (el.tagName || '').toLowerCase(),
      classes: classes,
      href: href,
      ariaLabel: ariaLabel,
      role: role,
      type: type,
      pathname: location.pathname
    };
  }

  let markedEl = null;
  let pickerActive = false;

  function setPickerActive(active) {
    pickerActive = active;
    pickBtn.classList.toggle('__tb_active', active);
    pickBtn.textContent = active ? 'Picking… click target' : 'Pick Element';
    if (!active) {
      document.querySelectorAll('.__tb_hover').forEach(function (el) {
        el.classList.remove('__tb_hover');
      });
    }
  }

  // ── Hover highlight ──────────────────────────────────────────────────────
  document.addEventListener('mouseover', function (e) {
    if (!pickerActive || panel.contains(e.target)) return;
    document.querySelectorAll('.__tb_hover').forEach(function (el) {
      el.classList.remove('__tb_hover');
    });
    if (e.target !== markedEl) e.target.classList.add('__tb_hover');
  }, true);

  // ── Click → mark ─────────────────────────────────────────────────────────
  let monitoring = false; // locked once Start Monitoring is clicked
  document.addEventListener('click', function (e) {
    if (panel.contains(e.target)) return;
    if (monitoring || !pickerActive) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    // Clear previous mark
    if (markedEl) markedEl.classList.remove('__tb_marked');

    markedEl = e.target;
    markedEl.classList.remove('__tb_hover');
    markedEl.classList.add('__tb_marked');

    const descriptor = buildDescriptor(e.target);
    const text = descriptor.text.slice(0, 40);
    info.innerHTML = '✓ Marked:<br><b>"' + text + '"</b>';
    btn.disabled = false;
    unmarkBtn.style.display = 'block';
    setPickerActive(false);
    window.__tb_mark(descriptor);
  }, true);

  pickBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (monitoring) return;
    setPickerActive(!pickerActive);
    if (pickerActive) {
      info.innerHTML = 'Picker enabled.<br><b>Click</b> the element to monitor';
    } else if (markedEl) {
      const text = (markedEl.innerText || markedEl.textContent || '').trim().slice(0, 40);
      info.innerHTML = '✓ Marked:<br><b>"' + text + '"</b>';
    } else {
      info.innerHTML = 'Browse normally.<br>Use <b>Pick Element</b> when ready.';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pickerActive) {
      setPickerActive(false);
      if (markedEl) {
        const text = (markedEl.innerText || markedEl.textContent || '').trim().slice(0, 40);
        info.innerHTML = '✓ Marked:<br><b>"' + text + '"</b>';
      } else {
        info.innerHTML = 'Browse normally.<br>Use <b>Pick Element</b> when ready.';
      }
    }
  });

  // ── Unmark button ─────────────────────────────────────────────────────────
  unmarkBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (markedEl) { markedEl.classList.remove('__tb_marked'); markedEl = null; }
    monitoring = false;
    setPickerActive(false);
    info.innerHTML = 'Browse normally.<br>Use <b>Pick Element</b> when ready.';
    btn.disabled = true;
    unmarkBtn.style.display = 'none';
    window.__tb_unmark();
  });

  // ── Start button ──────────────────────────────────────────────────────────
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    monitoring = true;
    setPickerActive(false);
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
    setPickerActive(false);
    info.innerHTML = 'Browse normally.<br>Use <b>Pick Element</b> when ready.';
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
  let markedDescriptor = null;
  let intervalId = null;
  let clicked = false;
  let isChecking = false;
  let lastLoadTime = Date.now();
  let lastPathMismatchLog = 0;

  // ── Expose Node callbacks to the browser tab ──────────────────────────────
  await page.exposeFunction("__tb_mark", (descriptor) => {
    markedDescriptor = descriptor;
    markedSelector = descriptor.selector;
    markedText = descriptor.text;
    console.log(`\n[${ts()}] Marked  : "${descriptor.text}"`);
    console.log(`         Selector: ${descriptor.selector}`);
    console.log(`         Path    : ${descriptor.pathname}`);
    console.log('         Now click "Start Monitoring" in the panel.\n');
  });

  await page.exposeFunction("__tb_unmark", () => {
    markedDescriptor = null;
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
    markedDescriptor = null;
    markedSelector = null;
    markedText = null;
    console.log(
      `[${ts()}] Monitoring CANCELLED — pick a new element to start again.`,
    );
  });

  await page.exposeFunction("__tb_start", () => {
    if (!markedDescriptor) {
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
        const result = await page.evaluate((descriptor) => {
          function normalize(value) {
            return String(value || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
          }

          function isVisible(el) {
            if (!el || !el.isConnected) return false;
            const style = window.getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.pointerEvents === "none"
            ) {
              return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          function elementText(el) {
            return normalize(
              el.innerText ||
                el.textContent ||
                el.value ||
                el.getAttribute("aria-label") ||
                "",
            );
          }

          function collectCandidates() {
            const seen = new Set();
            const list = [];

            function add(el) {
              if (!el || seen.has(el)) return;
              seen.add(el);
              list.push(el);
            }

            if (descriptor.selector) {
              document.querySelectorAll(descriptor.selector).forEach(add);
            }

            const interactiveSelector = [
              "button",
              "a",
              '[role="button"]',
              'input[type="button"]',
              'input[type="submit"]',
            ].join(",");

            document.querySelectorAll(interactiveSelector).forEach((el) => {
              const text = elementText(el);
              const ariaLabel = normalize(el.getAttribute("aria-label"));
              const href = el.getAttribute("href") || "";
              if (!descriptor.text && !descriptor.ariaLabel && !descriptor.href)
                return;
              if (descriptor.text && text === normalize(descriptor.text))
                add(el);
              else if (
                descriptor.ariaLabel &&
                ariaLabel === normalize(descriptor.ariaLabel)
              )
                add(el);
              else if (descriptor.href && href === descriptor.href) add(el);
            });

            return list;
          }

          function scoreCandidate(el) {
            let score = 0;
            const text = elementText(el);
            const ariaLabel = normalize(el.getAttribute("aria-label"));
            const href = el.getAttribute("href") || "";
            const role = el.getAttribute("role") || "";
            const type = el.getAttribute("type") || "";
            const tagName = (el.tagName || "").toLowerCase();
            const classList = new Set(Array.from(el.classList || []));

            if (descriptor.selector && el.matches(descriptor.selector))
              score += 120;
            if (descriptor.text && text === normalize(descriptor.text))
              score += 80;
            if (
              descriptor.ariaLabel &&
              ariaLabel === normalize(descriptor.ariaLabel)
            )
              score += 40;
            if (descriptor.href && href === descriptor.href) score += 40;
            if (descriptor.tagName && tagName === descriptor.tagName)
              score += 25;
            if (descriptor.role && role === descriptor.role) score += 15;
            if (descriptor.type && type === descriptor.type) score += 10;

            for (const cls of descriptor.classes || []) {
              if (classList.has(cls)) score += 6;
            }

            if (isVisible(el)) score += 20;
            return score;
          }

          if (
            descriptor.pathname &&
            location.pathname !== descriptor.pathname
          ) {
            return {
              clicked: false,
              reason: "path-mismatch",
              currentPath: location.pathname,
            };
          }

          const best = collectCandidates()
            .map((el) => ({ el, score: scoreCandidate(el) }))
            .filter((entry) => isVisible(entry.el))
            .sort((a, b) => b.score - a.score)[0];

          if (!best || best.score < 80) {
            return { clicked: false, reason: "not-found" };
          }

          best.el.click();
          return {
            clicked: true,
            text: (
              best.el.innerText ||
              best.el.textContent ||
              best.el.value ||
              ""
            )
              .trim()
              .slice(0, 80),
            score: best.score,
            currentPath: location.pathname,
          };
        }, markedDescriptor);

        if (result.reason === "path-mismatch") {
          if (Date.now() - lastPathMismatchLog > 5_000) {
            lastPathMismatchLog = Date.now();
            console.log(
              `[${ts()}] Waiting on original page ${markedDescriptor.pathname}; current page is ${result.currentPath}`,
            );
          }
        }

        if (result.clicked) {
          clicked = true;
          clearInterval(intervalId);
          const stamp = ts();
          console.log(
            `[${stamp}] ✅ FIRST CLICK: "${result.text || markedText}" (score ${result.score})`,
          );
          console.log(
            `[${stamp}] ⏳ Now auto-clicking "Book Tickets" on detail page…`,
          );

          // ── SECOND STAGE: auto-click "Book Tickets" on the detail page ──
          // Must wait for URL to change (SPA navigation) before clicking,
          // otherwise we'd match buttons on the listing page.
          try {
            const originalUrl = page.url();
            console.log(
              `[${ts()}] Waiting for URL change from: ${originalUrl}`,
            );

            // Wait for the URL to change — this is very fast for SPA navigation
            await page.waitForURL((url) => url.toString() !== originalUrl, {
              timeout: 15_000,
            });
            console.log(`[${ts()}] 📄 Now on: ${page.url()}`);

            // Immediately click — Playwright locator auto-waits for the element
            // to appear in DOM and be actionable, no manual delay needed
            const bookBtn = page
              .locator("button[aria-label='Book Tickets']")
              .first();
            await bookBtn.click({ timeout: 10_000 });
            console.log(`[${ts()}] ✅ SECOND CLICK: "Book Tickets" clicked!`);
            await sendWhatsAppAlert(
              `Queue entered! Both clicks done at ${ts()}`,
            );
          } catch (err) {
            console.log(`[${ts()}] First strategy failed: ${err.message}`);
            // Fallback: try text-based locator
            try {
              await page
                .locator("button", { hasText: "Book Tickets" })
                .first()
                .click({ timeout: 5_000 });
              console.log(
                `[${ts()}] ✅ SECOND CLICK (text fallback): clicked!`,
              );
              await sendWhatsAppAlert(`Queue entered at ${ts()}`);
            } catch (err2) {
              console.error(
                `[${ts()}] ❌ Second click failed: ${err2.message}`,
              );
              // Debug: dump page state
              try {
                const info = await page.evaluate(() => ({
                  url: location.href,
                  buttons: Array.from(document.querySelectorAll("button")).map(
                    (b) => ({
                      text: (b.innerText || "").trim().slice(0, 50),
                      ariaLabel: b.getAttribute("aria-label") || "",
                      visible: b.getBoundingClientRect().width > 0,
                    }),
                  ),
                }));
                console.log(
                  `[${ts()}] Page debug:`,
                  JSON.stringify(info, null, 2),
                );
              } catch (_) {}
            }
          }
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
    "  Step 1 — Use 'Pick Element' to select the 'Book tickets' button for your match.",
  );
  console.log("  Step 2 — Click 'Start Monitoring'. Bot will poll every 50ms.");
  console.log(
    "  Step 3 — When 'Book tickets' appears (countdown ends), bot clicks it.",
  );
  console.log(
    "  Step 4 — Bot auto-clicks 'Book Tickets' on the detail page to enter queue.\n",
  );

  await loadPage();
  await injectUI();
}

main().catch(console.error);
