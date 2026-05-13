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

const path = require("path");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

// ─── Config ───────────────────────────────────────────────────────────────────
const TARGET_URL = "https://district.in/events/ipl-ticket-booking";
const POLL_MS = 50;
const RELOAD_MS = 30_000;
const WAATSUP_GAME = true; // ← Set true to run WhatsApp Game Helper instead of ticket bot
const USER_DATA_DIR = path.join(__dirname, "browser-session"); // persists login across restarts
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
    #__tb_sep { border:0; border-top:1px solid #333; margin:10px 0 8px; }
    #__tb_double {
      background:none; border:1px solid #ffc107; color:#ffc107; border-radius:6px;
      padding:8px 0; cursor:pointer; font-size:13px; width:100%; font-weight:bold;
    }
    #__tb_double:hover:not(:disabled) { background:#ffc107; color:#111; }
    #__tb_double:disabled { background:#444; color:#777; cursor:default; border-color:#555; }
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
    <hr id="__tb_sep">
    <button id="__tb_double">⚡ Double Click</button>
  \`;
  document.body.appendChild(panel);

  const info      = document.getElementById('__tb_info');
  const btn       = document.getElementById('__tb_start');
  const unmarkBtn = document.getElementById('__tb_unmark');
  const pickBtn   = document.getElementById('__tb_pick');
  const cancelBtn = document.getElementById('__tb_cancel');
  const doubleBtn = document.getElementById('__tb_double');
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

  // ── Double Click button ──────────────────────────────────────────────────
  doubleBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    info.innerHTML = '⚡ <b>Double Click</b> active!<br>Click any <b>Book tickets</b> button yourself — bot will auto-click on the next page.';
    btn.disabled = true;
    pickBtn.disabled = true;
    doubleBtn.disabled = true;
    doubleBtn.style.background = '#ffc107';
    doubleBtn.style.color = '#111';
    cancelBtn.style.display = 'none';
    unmarkBtn.style.display = 'none';
    window.__tb_doubleClick();
  });
})();
`;

// ─── WhatsApp Game Mode Scripts ───────────────────────────────────────────────
// Injected into WhatsApp Web tab. GM_openInTab replaced by window.__tb_openTab.
const WA_GAME_SCRIPT = `(function() {
    'use strict';
    if (document.getElementById('__wa_game_style')) return;

    const INITIAL_SUFFIX = " song lyrics";

    const style = document.createElement('style');
    style.id = '__wa_game_style';
    style.innerHTML = \`
        .image-search-btn {
            position: absolute; top: 5px; left: 5px; cursor: pointer; z-index: 999;
            background: rgba(255, 255, 255, 0.9); border-radius: 50%; padding: 6px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.5); transition: transform 0.2s;
            font-size: 18px; display: flex; align-items: center; justify-content: center;
        }
        .image-search-btn:hover { transform: scale(1.15); background: white; }
        .song-icon-btn {
            display: inline-block; cursor: pointer; font-size: 16px; margin-left: 8px;
            vertical-align: bottom; background: rgba(255, 255, 255, 0.7);
            border-radius: 50%; padding: 2px 5px; transition: transform 0.1s;
        }
        .song-icon-btn:hover { transform: scale(1.2); background: #e0e0e0; }
        #game-helper-panel {
            position: fixed; bottom: 18px; right: 18px; z-index: 999999;
            background: #202c33; border: 2px solid #00a884; border-radius: 12px;
            padding: 0; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            font-family: sans-serif; color: #fff;
            width: 340px; min-width: 220px; min-height: 110px;
            display: flex; flex-direction: column;
            resize: both; overflow: auto;
        }
        #game-helper-titlebar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 12px; cursor: grab; background: #1a252c;
            border-bottom: 1px solid #2d3b43; border-radius: 10px 10px 0 0;
            user-select: none; flex-shrink: 0;
        }
        #game-helper-titlebar:active { cursor: grabbing; }
        #game-helper-titlebar-label {
            font-size: 13px; font-weight: bold; color: #00a884; letter-spacing: 0.5px;
        }
        #game-helper-titlebar-hint {
            font-size: 10px; color: #3b4a54;
        }
        #game-helper-body {
            padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1;
        }
        #game-helper-panel label {
            font-size: 11px; color: #8696a0; margin-bottom: 2px; display: block;
        }
        #game-helper-suffix {
            width: 100%; padding: 7px 10px; font-size: 14px; border: 1px solid #3b4a54;
            border-radius: 6px; outline: none; background: #2a3942; color: #d1d7db;
            box-sizing: border-box; transition: border-color 0.2s;
        }
        #game-helper-suffix:focus { border-color: #00a884; }
        #game-helper-suffix::selection { background: #00a884; color: white; }
        #game-helper-last {
            font-size: 11px; color: #8696a0; word-break: break-all;
            overflow: hidden; flex: 1;
        }
    \`;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'game-helper-panel';
    panel.innerHTML = \`
        <div id="game-helper-titlebar">
            <span id="game-helper-titlebar-label">🎮 Game Helper</span>
            <span id="game-helper-titlebar-hint">⠿ drag</span>
        </div>
        <div id="game-helper-body">
            <div>
                <label for="game-helper-suffix">Search suffix (appended to every 🎵 click)</label>
                <input type="text" id="game-helper-suffix" value="" spellcheck="false">
            </div>
            <div id="game-helper-last"></div>
        </div>
    \`;
    document.body.appendChild(panel);

    const suffixInput = document.getElementById('game-helper-suffix');
    const lastLabel   = document.getElementById('game-helper-last');
    suffixInput.value = INITIAL_SUFFIX;

    // ── Drag to move ─────────────────────────────────────────────────────────
    (function() {
        const titlebar = document.getElementById('game-helper-titlebar');
        let dragging = false, offX = 0, offY = 0;
        titlebar.addEventListener('mousedown', function(e) {
            dragging = true;
            const r = panel.getBoundingClientRect();
            offX = e.clientX - r.left;
            offY = e.clientY - r.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            panel.style.left = (e.clientX - offX) + 'px';
            panel.style.top  = (e.clientY - offY) + 'px';
        });
        document.addEventListener('mouseup', function() { dragging = false; });
    })();

    const copyImageToClipboard = async (imgElement) => {
        try {
            const response = await fetch(imgElement.src);
            const rawBlob = await response.blob();
            const imageBitmap = await createImageBitmap(rawBlob);
            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);
            return new Promise((resolve, reject) => {
                canvas.toBlob(async (pngBlob) => {
                    try {
                        const item = new ClipboardItem({ 'image/png': pngBlob });
                        await navigator.clipboard.write([item]);
                        resolve();
                    } catch (e) {
                        alert("Clipboard permission denied. Please click 'Allow' if prompted.");
                        reject(e);
                    }
                }, 'image/png');
            });
        } catch (err) {
            console.error('Failed to process image: ', err);
        }
    };

    const processMessages = () => {
        const textElements = document.querySelectorAll('.copyable-text');
        textElements.forEach(textContainer => {
            if (textContainer.dataset.helperAdded || !textContainer.innerText) return;
            const textBtn = document.createElement('span');
            textBtn.innerHTML = '🎵';
            textBtn.className = 'song-icon-btn';
            textBtn.title = "Search Context";
            textBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                let rawText = textContainer.innerText || textContainer.textContent;
                let cleanText = rawText.replace(/🎵|✅/g, '')
                                       .replace(/Song Lyrics/gi, '')
                                       .replace(/Lyrics/gi, '')
                                       .replace(/\\n/g, ' ')
                                       .trim();
                if (cleanText.length < 2) return;
                const suffix = suffixInput.value;
                let finalSearchQuery = cleanText + suffix;
                try { await navigator.clipboard.writeText(finalSearchQuery); } catch (err) {}
                lastLabel.textContent = '🔍 ' + finalSearchQuery;
                window.__tb_openTab('https://www.google.com/search?q=' + encodeURIComponent(finalSearchQuery));
            };
            textContainer.appendChild(textBtn);
            textContainer.dataset.helperAdded = "true";
        });

        const imgElements = document.querySelectorAll('img[src^="blob:"]');
        imgElements.forEach(imgElement => {
            if (imgElement.dataset.helperAdded) return;
            const imgContainer = imgElement.closest('div');
            if (imgContainer) {
                imgContainer.style.position = 'relative';
                const imgBtn = document.createElement('div');
                imgBtn.innerHTML = '🔍';
                imgBtn.className = 'image-search-btn';
                imgBtn.title = "Search with Google Lens";
                imgBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const originalIcon = imgBtn.innerHTML;
                    imgBtn.innerHTML = '⏳';
                    await copyImageToClipboard(imgElement);
                    imgBtn.innerHTML = originalIcon;
                    lastLabel.textContent = '🔍 Searching image with Lens…';
                    window.__tb_openLensTab('https://lens.google.com/search?p=', suffixInput.value);
                };
                imgContainer.appendChild(imgBtn);
                imgElement.dataset.helperAdded = "true";
            }
        });
    };

    let timeout;
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(processMessages, 300);
    });

    let checkExist = setInterval(function() {
        const app = document.querySelector('#app') || document.body;
        if (app) {
            console.log("WhatsApp Game Helper: DOM loaded, attaching observer.");
            observer.observe(app, { childList: true, subtree: true });
            clearInterval(checkExist);
        }
    }, 1000);
})();
`;

// Injected into every Google Search / Google Lens tab opened by the WA helper.
const GOOGLE_AUTOTYPER_SCRIPT = `(function() {
    'use strict';
    const href = window.location.href;
    // Run on all google.com pages (search results + Lens results)
    // Auto-type on Lens removed — image is pasted from Node side automatically
    if (!href.includes('google.com')) return;

    const style = document.createElement('style');
    style.innerHTML = \`
        .quick-copy-btn {
            cursor: pointer; margin-left: 6px; font-size: 14px;
            text-decoration: none; display: inline-block; background: #e8eaed;
            border-radius: 4px; padding: 2px 6px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.1s;
        }
        .quick-copy-btn:hover { background: #d2e3fc; transform: scale(1.1); }
    \`;
    document.head.appendChild(style);

    const addCopyIcons = () => {
        const boldTags = document.querySelectorAll('b, strong');
        boldTags.forEach(tag => {
            if (tag.nextSibling?.className === 'quick-copy-btn' ||
                !tag.innerText.trim() || tag.innerText.length > 50) return;
            const btn = document.createElement('span');
            btn.innerHTML = '📋';
            btn.className = 'quick-copy-btn';
            btn.title = "Copy & Close Tab";
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const textToCopy = tag.innerText.trim();
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    try { await window.__tb_copyDone(); } catch(_) {}
                    window.close();
                } catch (err) {
                    console.error('Failed to copy', err);
                    alert('Copy failed. Please click "Allow" if the browser asks for clipboard permissions.');
                }
            };
            tag.parentNode.insertBefore(btn, tag.nextSibling);
        });
    };

    const observer = new MutationObserver(() => { addCopyIcons(); });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.close();
    });
})();
`;

// ─── WhatsApp Game Mode ───────────────────────────────────────────────────────
async function runWhatsAppGameMode(context, page) {
  console.log(`[${ts()}] WhatsApp Game Mode — opening WhatsApp Web…`);
  console.log(
    "  Click 🎵 next to any message to search song lyrics on Google.",
  );
  console.log("  Click 🔍 on any image to open Google Lens.\n");

  // Expose helper bridges that injected scripts can call
  const exposeOpenTab = async (p) => {
    try {
      await p.exposeFunction("__tb_openTab", async (url) => {
        try {
          const newPage = await context.newPage();
          await newPage.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
        } catch (err) {
          console.error(`[${ts()}] Failed to open tab: ${err.message}`);
        }
      });
    } catch (_) {
      /* already exposed */
    }
    try {
      // Used for image search: opens Lens, pastes image, then pastes suffix query
      await p.exposeFunction("__tb_openLensTab", async (url, query) => {
        try {
          const newPage = await context.newPage();
          await newPage.bringToFront();

          // Paste image as soon as the upload page loads — fire-and-forget listener
          newPage.once("load", async () => {
            try {
              const vp = newPage.viewportSize();
              const cx = vp ? Math.round(vp.width / 2) : 760;
              const cy = vp ? Math.round(vp.height / 2) : 490;
              await newPage.mouse.click(cx, cy);
              await newPage.keyboard.press("Control+v");
            } catch (_) {}
          });

          // Navigate directly to the Lens upload dialog (skips lens.google.com redirect)
          await newPage.goto("https://www.google.com/?olud", {
            waitUntil: "load",
            timeout: 15_000,
          });

          // After paste, Google navigates to the vsrid results page.
          // Write the suffix into clipboard then paste it into "Add to your search".
          if (query && query.trim()) {
            try {
              if (!newPage.url().includes("vsrid")) {
                await newPage.waitForURL(
                  (u) => u.toString().includes("vsrid"),
                  { timeout: 20_000 },
                );
              }
              // Write suffix to clipboard immediately — no load state wait
              await newPage.evaluate(
                (q) => navigator.clipboard.writeText(q),
                query.trim(),
              );
              // Wait for the "Add to your search" input to appear, then paste + Enter
              let inputFocused = false;
              try {
                await newPage
                  .getByPlaceholder(/add to your search/i)
                  .first()
                  .waitFor({ timeout: 8_000 });
                await newPage
                  .getByPlaceholder(/add to your search/i)
                  .first()
                  .click();
                inputFocused = true;
              } catch (_) {}
              if (!inputFocused) {
                try {
                  const inp = newPage
                    .locator("input[jsname], textarea[jsname]")
                    .first();
                  await inp.waitFor({ timeout: 3_000 });
                  await inp.click();
                  inputFocused = true;
                } catch (_) {}
              }
              if (!inputFocused) {
                const vp = newPage.viewportSize();
                await newPage.mouse.click(
                  vp ? Math.round(vp.width / 2) : 640,
                  115,
                );
              }
              await newPage.keyboard.press("Control+v");
              await newPage.keyboard.press("Enter");
              // Collapse the image panel so results are visible: click the ^ chevron in the search bar
              try {
                await newPage.waitForLoadState("domcontentloaded", {
                  timeout: 5_000,
                });
                // Try the collapse/chevron button Google Lens shows in the search bar
                const collapsed = await newPage.evaluate(() => {
                  const btn = Array.from(
                    document.querySelectorAll(
                      'div[role="button"], button, span[role="button"]',
                    ),
                  ).find((el) => {
                    const aria = (
                      el.getAttribute("aria-label") || ""
                    ).toLowerCase();
                    const title = (
                      el.getAttribute("title") || ""
                    ).toLowerCase();
                    return (
                      aria.includes("collaps") ||
                      aria.includes("hide") ||
                      title.includes("collaps") ||
                      title.includes("hide")
                    );
                  });
                  if (btn) {
                    btn.click();
                    return true;
                  }
                  // Fallback: click the ^ icon (aria-expanded=true element near search bar)
                  const exp = document.querySelector(
                    '[aria-expanded="true"][jsaction]',
                  );
                  if (exp) {
                    exp.click();
                    return true;
                  }
                  return false;
                });
                if (!collapsed) {
                  // Last resort: press Escape which collapses the image panel on Google Lens results
                  await newPage.keyboard.press("Escape");
                }
              } catch (_) {}
            } catch (err) {
              console.error(
                `[${ts()}] Lens query paste failed: ${err.message}`,
              );
            }
          }
        } catch (err) {
          console.error(`[${ts()}] Failed to open Lens tab: ${err.message}`);
        }
      });
    } catch (_) {
      /* already exposed */
    }
    try {
      await p.exposeFunction("__tb_copyDone", async () => {
        try {
          await page.bringToFront();
          // Focus the message input of whichever chat is currently open
          const input = page
            .locator("#main footer div[contenteditable]")
            .first();
          await input.click({ timeout: 3_000 });
          // Paste clipboard content
          await page.keyboard.press("Control+v");
        } catch (err) {
          console.error(
            `[${ts()}] WhatsApp focus/paste failed: ${err.message}`,
          );
        }
      });
    } catch (_) {
      /* already exposed */
    }
  };

  await exposeOpenTab(page);

  // For every new tab (Google / Lens) opened by the helper, inject the auto-typer
  context.on("page", async (newPage) => {
    await exposeOpenTab(newPage);
    newPage.on("load", async () => {
      const url = newPage.url();
      if (url.includes("google.com")) {
        try {
          await newPage.evaluate(GOOGLE_AUTOTYPER_SCRIPT);
        } catch (_) {}
      }
    });
  });

  const injectWAHelper = async () => {
    if (page.url().includes("web.whatsapp.com")) {
      try {
        await page.evaluate(WA_GAME_SCRIPT);
      } catch (_) {}
    }
  };

  page.on("load", injectWAHelper);

  try {
    await page.goto("https://web.whatsapp.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (err) {
    console.error(`[${ts()}] Navigation error: ${err.message}`);
  }
  await injectWAHelper();
  console.log(`[${ts()}] WhatsApp Web loaded. Game helper active.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // launchPersistentContext saves cookies/localStorage to USER_DATA_DIR so
  // WhatsApp Web (and district.in) stay logged in between restarts.
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: ["--start-maximized"],
    viewport: null,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  if (WAATSUP_GAME) {
    await runWhatsAppGameMode(context, page);
    return;
  }

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

  await page.exposeFunction("__tb_doubleClick", async () => {
    console.log(`[${ts()}] ⚡ Double Click mode activated`);
    console.log(
      `  Click any "Book tickets" card — bot will auto-click on the detail page.\n`,
    );

    // Register in-browser auto-clicker for maximum speed (runs before page JS)
    await context.addInitScript(() => {
      // Only run on detail pages (not the listing page)
      if (location.pathname === "/events/ipl-ticket-booking") return;

      let done = false;
      let observer;
      let fallbackInterval;

      function tryClick() {
        if (done) return true;
        const buttons = document.querySelectorAll(
          'button, a[role="button"], [role="button"]',
        );
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || "")
            .trim()
            .toLowerCase();
          const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
          if (text.includes("book ticket") || aria.includes("book ticket")) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              console.log("[TicketBot] Found button:", text, "| aria:", aria);
              btn.click();
              btn.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }),
              );
              btn.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true }),
              );
              btn.dispatchEvent(
                new PointerEvent("pointerup", { bubbles: true }),
              );
              btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
              btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              console.log('[TicketBot] ✅ Auto-clicked "Book Tickets"!');
              done = true;
              if (observer) observer.disconnect();
              if (fallbackInterval) clearInterval(fallbackInterval);
              return true;
            }
          }
        }
        return false;
      }

      function setup() {
        if (tryClick()) return;
        observer = new MutationObserver(() => tryClick());
        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
        });
        fallbackInterval = setInterval(() => {
          if (tryClick()) {
            clearInterval(fallbackInterval);
            if (observer) observer.disconnect();
          }
        }, 30);
        setTimeout(() => {
          if (observer) observer.disconnect();
          if (fallbackInterval) clearInterval(fallbackInterval);
        }, 30000);
      }

      if (document.body) {
        setup();
      } else {
        document.addEventListener("DOMContentLoaded", setup);
      }
    });

    // Node-side fallback: watch for URL change then use Playwright locator
    const originalUrl = page.url();
    (async () => {
      try {
        await page.waitForURL((url) => url.toString() !== originalUrl, {
          timeout: 120_000,
        });
        console.log(`[${ts()}] 📄 Navigated to: ${page.url()}`);
        // Playwright locator auto-waits for the element to appear and be actionable
        const bookBtn = page
          .locator("button[aria-label='Book Tickets']")
          .first();
        await bookBtn.click({ timeout: 10_000 });
        console.log(
          `[${ts()}] ✅ SECOND CLICK (Playwright): "Book Tickets" clicked!`,
        );
        await sendWhatsAppAlert(`Queue entered at ${ts()}`);
      } catch (err) {
        console.log(`[${ts()}] Playwright fallback: ${err.message}`);
        try {
          await page
            .locator("button", { hasText: "Book Tickets" })
            .first()
            .click({ timeout: 5_000 });
          console.log(`[${ts()}] ✅ SECOND CLICK (text fallback): clicked!`);
          await sendWhatsAppAlert(`Queue entered at ${ts()}`);
        } catch (err2) {
          console.error(
            `[${ts()}] ❌ Double Click second click failed: ${err2.message}`,
          );
        }
      }
    })();
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
    "  Step 4 — Bot auto-clicks 'Book Tickets' on the detail page to enter queue.",
  );
  console.log(
    "\n  OR use ⚡ Double Click — you click the match card yourself, bot handles the rest.\n",
  );

  await loadPage();
  await injectUI();
}

main().catch(console.error);
