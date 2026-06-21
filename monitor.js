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

    const INITIAL_SUFFIX = " find this brand name";

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
            display: inline-flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 17px; width: 32px; height: 32px;
            border-radius: 50%; flex-shrink: 0;
            transition: background 0.15s, transform 0.15s;
        }
        .song-icon-btn:hover { background: rgba(0,0,0,0.1); transform: scale(1.18); }
        [data-tb-song-anchor] { position: relative !important; }
        [data-tb-song-anchor] .song-icon-btn {
            position: absolute; right: -34px; top: 50%; transform: translateY(-50%);
            background: rgba(255,255,255,0.85); box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }
        [data-tb-song-anchor] .song-icon-btn:hover { background: #fff; transform: translateY(-50%) scale(1.18); }
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
        #game-helper-close-all {
            background: #ff5c75; color: #fff; border: none; border-radius: 4px;
            padding: 2px 6px; font-size: 10px; cursor: pointer; font-weight: bold;
            margin-right: 8px; transition: background 0.15s; outline: none;
        }
        #game-helper-close-all:hover { background: #ff8597; }
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
        #game-helper-ai-toggle {
          background: none; border: 1px solid #555; color: #8696a0; border-radius: 4px;
          padding: 2px 6px; font-size: 10px; cursor: pointer; font-weight: bold;
          margin-right: 6px; transition: background 0.15s, color 0.15s, border-color 0.15s; outline: none;
        }
        #game-helper-ai-toggle.active {
          background: #7aa2ff; border-color: #7aa2ff; color: #111;
        }
        #game-helper-ai-toggle:hover:not(.active) { border-color: #7aa2ff; color: #7aa2ff; }
        #game-helper-num-toggle {
            background: none; border: 1px solid #555; color: #8696a0; border-radius: 4px;
            padding: 2px 6px; font-size: 10px; cursor: pointer; font-weight: bold;
            margin-right: 6px; transition: background 0.15s, color 0.15s, border-color 0.15s; outline: none;
        }
        #game-helper-num-toggle.active {
            background: #f0a500; border-color: #f0a500; color: #111;
        }
        #game-helper-num-toggle:hover:not(.active) { border-color: #f0a500; color: #f0a500; }
        #game-helper-bracket-toggle {
            background: none; border: 1px solid #555; color: #8696a0; border-radius: 4px;
            padding: 2px 6px; font-size: 10px; cursor: pointer; font-weight: bold;
            margin-right: 6px; transition: background 0.15s, color 0.15s, border-color 0.15s; outline: none;
        }
        #game-helper-bracket-toggle.active {
            background: #00a884; border-color: #00a884; color: #fff;
        }
        #game-helper-bracket-toggle:hover:not(.active) { border-color: #00a884; color: #00a884; }
    \`;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'game-helper-panel';
    panel.innerHTML = \`
        <div id="game-helper-titlebar">
            <span id="game-helper-titlebar-label">🎮 Game Helper</span>
            <div style="display: flex; align-items: center;">
            <button id="game-helper-ai-toggle" title="Always open Google in AI Mode">AI</button>
                <button id="game-helper-num-toggle" title="Strip leading number (e.g. 1) from copied text">#</button>
                <button id="game-helper-bracket-toggle" title="Wrap copied text in quotes: &quot;text&quot;suffix">" "</button>
                <button id="game-helper-close-all" title="Close other tabs except WhatsApp">Close All</button>
                <span id="game-helper-titlebar-hint">⠿ drag</span>
            </div>
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

    let aiModeEnabled = false;
    const aiToggleBtn = document.getElementById('game-helper-ai-toggle');
    if (aiToggleBtn) {
      aiToggleBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        aiModeEnabled = !aiModeEnabled;
        aiToggleBtn.classList.toggle('active', aiModeEnabled);
        aiToggleBtn.textContent = aiModeEnabled ? 'AI ON' : 'AI';
        aiToggleBtn.title = aiModeEnabled
          ? 'AI Mode ON — searches open directly in Google AI Mode'
          : 'Always open Google in AI Mode';
      };
      aiToggleBtn.onmousedown = (e) => { e.stopPropagation(); };
    }

    let numStripEnabled = false;
    const numToggleBtn = document.getElementById('game-helper-num-toggle');
    if (numToggleBtn) {
        numToggleBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            numStripEnabled = !numStripEnabled;
            numToggleBtn.classList.toggle('active', numStripEnabled);
            numToggleBtn.textContent = numStripEnabled ? '# ON' : '#';
            numToggleBtn.title = numStripEnabled
                ? 'Number strip ON — leading number (e.g. 1) ) removed from copied text'
                : 'Strip leading number (e.g. 1) from copied text';
        };
        numToggleBtn.onmousedown = (e) => { e.stopPropagation(); };
    }

    let bracketWrapEnabled = false;
    const bracketToggleBtn = document.getElementById('game-helper-bracket-toggle');
    if (bracketToggleBtn) {
        bracketToggleBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            bracketWrapEnabled = !bracketWrapEnabled;
            bracketToggleBtn.classList.toggle('active', bracketWrapEnabled);
            bracketToggleBtn.textContent = bracketWrapEnabled ? '" " ON' : '" "';
            bracketToggleBtn.title = bracketWrapEnabled
                ? 'Quote wrap ON — copied text will be "text"suffix'
                : 'Wrap copied text in quotes: "text"suffix';
        };
        bracketToggleBtn.onmousedown = (e) => { e.stopPropagation(); };
    }

    const closeAllBtn = document.getElementById('game-helper-close-all');
    if (closeAllBtn) {
        closeAllBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { await window.__tb_closeOtherTabs(); } catch (_) {}
        };
        closeAllBtn.onmousedown = (e) => {
            e.stopPropagation();
        };
    }

    // ── Drag to move ─────────────────────────────────────────────────────────
    (function() {
        const titlebar = document.getElementById('game-helper-titlebar');
        let dragging = false, offX = 0, offY = 0;
        titlebar.addEventListener('mousedown', function(e) {
            if (e.target.id === 'game-helper-close-all') return;
          if (e.target.id === 'game-helper-ai-toggle') return;
            if (e.target.id === 'game-helper-num-toggle') return;
            if (e.target.id === 'game-helper-bracket-toggle') return;
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

    // Returns the image as a PNG data URL so it can be uploaded to Lens via its
    // file input (no clipboard / tab focus needed — keeps the search off-screen).
    const getImagePngDataUrl = async (imgElement) => {
        try {
            const response = await fetch(imgElement.src);
            const rawBlob = await response.blob();
            const imageBitmap = await createImageBitmap(rawBlob);
            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);
            return canvas.toDataURL('image/png');
        } catch (err) {
            console.error('Failed to read image: ', err);
            return null;
        }
    };

    const processMessages = () => {
        const textElements = document.querySelectorAll('.copyable-text');
        textElements.forEach(textContainer => {
            const hasImgEmoji = textContainer.querySelector('img[alt]');
            if (textContainer.dataset.helperAdded || (!textContainer.innerText && !hasImgEmoji)) return;
            textContainer.dataset.helperAdded = "true";

            const msgRow = textContainer.closest('[data-id]');
            if (!msgRow || msgRow.dataset.tbSongAnchor) return;
            msgRow.dataset.tbSongAnchor = "true";

            const textBtn = document.createElement('span');
            textBtn.innerHTML = '🎵';
            textBtn.className = 'song-icon-btn';
            textBtn.title = "Search Context";
            textBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Walk the live DOM — reads text nodes and emoji <img alt="..."> by alt.
                // We already scope to span[dir="ltr"] which is the message content only;
                // the timestamp lives outside that span so no extra filtering is needed.
                function extractMsgText(node) {
                    if (node.nodeType === 3) return node.textContent;
                    if (node.nodeName === 'IMG') return node.alt || '';
                    return Array.from(node.childNodes).map(extractMsgText).join('');
                }
                const contentEl = textContainer.querySelector('span[dir="ltr"], span[dir="rtl"]') || textContainer;
                let rawText = extractMsgText(contentEl);
                let cleanText = rawText.replace(/🎵|✅/g, '')
                                       .replace(/Song Lyrics/gi, '')
                                       .replace(/Lyrics/gi, '')
                                       .replace(/\\b\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM))?\\b/gi, '')
                                       .replace(/\\s+/g, ' ')
                                       .replace(/\\n/g, ' ')
                                       .trim();
                if (numStripEnabled) cleanText = cleanText.replace(/^\\d+[).]\\s*/, '');
                if (cleanText.length < 2) return;
                const suffix = suffixInput.value;
                let finalSearchQuery = bracketWrapEnabled ? '"' + cleanText + '"' + suffix : cleanText + suffix;
                try { await navigator.clipboard.writeText(finalSearchQuery); } catch (err) {}
                lastLabel.textContent = '🔍 ' + finalSearchQuery;
                const searchUrl = new URL('https://www.google.com/search');
                searchUrl.searchParams.set('q', finalSearchQuery);
                if (aiModeEnabled) {
                  searchUrl.searchParams.set('udm', '50');
                }
                window.__tb_openTab(searchUrl.toString());
            };

            // Try to inject into WhatsApp's action bar (same row as the react 😊 button).
            // The action bar is the container holding [aria-label] / [role="button"] elements
            // that are OUTSIDE the text bubble (i.e. don't contain .copyable-text).
            let actionsContainer = null;
            const candidates = msgRow.querySelectorAll('[aria-label], [role="button"]');
            for (const el of candidates) {
                if (el === msgRow) continue;
                if (!el.contains(textContainer) && !textContainer.contains(el)) {
                    const parent = el.parentElement;
                    if (parent && !parent.contains(textContainer)) {
                        actionsContainer = parent;
                        break;
                    }
                }
            }

            if (actionsContainer) {
                actionsContainer.appendChild(textBtn);
            } else {
                // Fallback: pin to the right edge of the bubble div
                let anchor = textContainer.parentElement;
                while (anchor && (anchor.tagName !== 'DIV' || anchor === document.body)) {
                    anchor = anchor.parentElement;
                }
                if (anchor) {
                    anchor.dataset.tbSongAnchor = "true";
                    anchor.appendChild(textBtn);
                }
            }
        });

        const imgElements = document.querySelectorAll('img[src^="blob:"]');
        imgElements.forEach(imgElement => {
            if (imgElement.dataset.helperAdded) return;
            imgElement.dataset.helperAdded = "true"; // mark BEFORE DOM changes to prevent observer race
            const imgContainer = imgElement.closest('div');
            if (imgContainer) {
                imgContainer.style.position = 'relative';
                const imgBtn = document.createElement('div');
                imgBtn.innerHTML = '🔍';
                imgBtn.className = 'image-search-btn';
                imgBtn.title = "Search with Google Lens";
                let imgBtnBusy = false;
                imgBtn.onclick = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (imgBtnBusy) return; // prevent re-entry on rapid/double clicks
                    imgBtnBusy = true;
                    const originalIcon = imgBtn.innerHTML;
                    imgBtn.innerHTML = '⏳';
                    imgBtn.style.pointerEvents = 'none';
                    // Put the image on the clipboard so the new tab can paste it
                    // (Ctrl+V) — the same as a human pasting it into the box.
                    await copyImageToClipboard(imgElement);
                    imgBtn.innerHTML = originalIcon;
                    imgBtn.style.pointerEvents = '';
                    lastLabel.textContent = '🔍 Searching image with Lens…';
                    window.__tb_openLensTab(suffixInput.value);
                    // keep locked for 8 s so copy-answer click can't re-trigger a search
                    setTimeout(() => { imgBtnBusy = false; }, 8000);
                };
                imgContainer.appendChild(imgBtn);
            }
        });
    };

    let timeout;
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(processMessages, 0);
    });

    let ctrlDown = false;
    let otherKeyPressed = false;
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Control') {
            ctrlDown = true;
            otherKeyPressed = false;
        } else if (ctrlDown) {
            otherKeyPressed = true;
        }
    }, true);

    document.addEventListener('keyup', function(e) {
        if (e.key === 'Control') {
            ctrlDown = false;
            if (!otherKeyPressed) {
                const active = document.activeElement;
                if (active && (active.getAttribute('contenteditable') === 'true' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    });
                    active.dispatchEvent(enterEvent);
                }
            }
        }
    }, true);

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

    if (window.__googleAutotyperInitialized) return;
    window.__googleAutotyperInitialized = true;

    const style = document.createElement('style');
    style.innerHTML = \`
        .quick-copy-btn {
            cursor: pointer; margin-left: 6px; font-size: 14px;
            text-decoration: none; display: inline-block; background: #e8eaed;
            border-radius: 4px; padding: 2px 6px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.1s;
        }
        .quick-copy-btn:hover { background: #d2e3fc; transform: scale(1.1); }
        .quick-copy-btn.copied { background: #34a853 !important; color: #fff; transform: scale(1.2); }
        .quick-copy-row { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; vertical-align: middle; }
        .game-highlight { background-color: yellow !important; color: #000 !important; font-weight: bold; }
        .game-snippet-answered { border-left: 4px solid #3b82f6 !important; padding-left: 8px !important; margin: 4px 0 !important; }
        #tb-selection-send {
          position: fixed; z-index: 2147483647;
          background: #1f2937; color: #fff;
          border: 1px solid #3b82f6; border-radius: 999px;
          padding: 6px 10px; font-size: 12px; font-family: sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          cursor: pointer; user-select: none;
        }
        #tb-selection-send:hover { background: #111827; }
    \`;
    document.head.appendChild(style);

      async function sendToWhatsApp(textToCopy, closeTabAfter, elementToFlash, shouldSend) {
        if (!textToCopy || !textToCopy.trim()) return;
        const cleanedText = String(textToCopy)
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\u00A0/g, ' ')
          .replace(/\\s*,\\s*/g, ', ')
          .replace(/\\s+/g, ' ')
          .trim()
          .replace(/^["""'''\u2018\u2019\u201C\u201D]+/, '')
          .replace(/["""'''\u2018\u2019\u201C\u201D]+$/, '')
          .trim();
        if (!cleanedText) return;
        try {
          await navigator.clipboard.writeText(cleanedText);
          // if (elementToFlash) {
          //   elementToFlash.classList.add('copied');
          //   const originalVal = elementToFlash.innerHTML;
          //   if (originalVal.length < 5) {
          //     elementToFlash.innerHTML = '✓';
          //   } else {
          //     elementToFlash.innerHTML = '✓ Sent';
          //   }
          //   setTimeout(() => {
          //     elementToFlash.classList.remove('copied');
          //     elementToFlash.innerHTML = originalVal;
          //   }, 1000);
          // }
          try { await window.__tb_copyDone(cleanedText, closeTabAfter, !!shouldSend); } catch(_) {}
        } catch (err) {
          console.error('Failed to copy', err);
          alert('Copy failed. Please click "Allow" if the browser asks for clipboard permissions.');
        }
      }

      async function sendSelectionToWhatsApp(closeTabAfter) {
        const selection = window.getSelection();
        const selectedText = selection ? (selection.toString() || '') : '';
        if (!selectedText.trim()) return;

        let copied = false;
        try {
          if (typeof document.execCommand === 'function') {
            copied = document.execCommand('copy');
          }
        } catch (_) {}

        if (!copied) {
          try {
            await navigator.clipboard.writeText(selectedText);
            copied = true;
          } catch (_) {}
        }

        if (!copied) {
          alert('Could not copy selection. Press Ctrl+C once and try again.');
          return;
        }

        try {
          // Call without explicit text so WhatsApp side pastes clipboard content (Ctrl+V path).
          await window.__tb_copyDone(null, closeTabAfter);
        } catch (err) {
          console.error('Send to WhatsApp failed:', err);
        }
      }

      function getElementTextWithoutButtons(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll('.quick-copy-row, .quick-copy-btn').forEach(n => n.remove());
        return (clone.innerText || clone.textContent || '').trim();
      }

    const addCopyIcons = () => {
        // 1. Identify and highlight the exact search terms/question terms from the URL if present
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const query = urlParams.get('q');
            if (query && !window.__game_highlighted) {
                window.__game_highlighted = true;
                const terms = query.toLowerCase()
                  .replace(/song lyrics/gi, '')
                  .replace(/lyrics/gi, '')
                  .split(' ')
                  .map(t => t.trim())
                  .filter(t => t.length > 2);
                  
                if (terms.length > 0) {
                    const walkAndHighlight = (node) => {
                        if (node.nodeType === 3) { // Text node
                            const text = node.nodeValue;
                            let matchFound = false;
                            let lowerText = text.toLowerCase();
                            
                            // Find the first term that matches
                            for (const term of terms) {
                                const idx = lowerText.indexOf(term);
                                if (idx !== -1 && !node.parentNode.classList?.contains('game-highlight') && !node.parentNode.closest('#tb-selection-send') && node.parentNode.tagName !== 'SCRIPT' && node.parentNode.tagName !== 'STYLE' && node.parentNode.tagName !== 'INPUT' && node.parentNode.tagName !== 'TEXTAREA') {
                                    const span = document.createElement('span');
                                    span.className = 'game-highlight';
                                    const matchedText = text.slice(idx, idx + term.length);
                                    
                                    const beforeText = document.createTextNode(text.slice(0, idx));
                                    const afterText = document.createTextNode(text.slice(idx + term.length));
                                    span.appendChild(document.createTextNode(matchedText));
                                    
                                    const parent = node.parentNode;
                                    parent.insertBefore(beforeText, node);
                                    parent.insertBefore(span, node);
                                    parent.insertBefore(afterText, node);
                                    parent.removeChild(node);
                                    
                                    // Walk on remaining parts
                                    walkAndHighlight(afterText);
                                    matchFound = true;
                                    break;
                                }
                            }
                        } else if (node.nodeType === 1 && node.childNodes && !node.classList?.contains('game-highlight') && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && node.id !== 'tb-selection-send') {
                            Array.from(node.childNodes).forEach(walkAndHighlight);
                        }
                    };
                    // Only walk over primary main result blocks to stay extremely fast
                    const container = document.querySelector('#rso') || document.body;
                    if (container) walkAndHighlight(container);
                }
            }
        } catch (_) {}

        // 2. Bold tags instrumentation
        const boldTags = document.querySelectorAll('b, strong');
        boldTags.forEach(tag => {
            if (tag.dataset.tbCopyAdded ||
                !tag.innerText.trim() || tag.innerText.length > 50 || tag.closest('#tb-selection-send')) return;
            tag.dataset.tbCopyAdded = 'true';
            const actionRow = document.createElement('span');
            actionRow.className = 'quick-copy-row';
            const pasteBtn = document.createElement('span');
            pasteBtn.innerHTML = '📥';
            pasteBtn.className = 'quick-copy-btn';
            pasteBtn.title = 'Paste to WhatsApp (no send)';
            pasteBtn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                await sendToWhatsApp(getElementTextWithoutButtons(tag), false, pasteBtn, false);
            };
            const sendBtn = document.createElement('span');
            sendBtn.innerHTML = '✅';
            sendBtn.className = 'quick-copy-btn';
            sendBtn.title = 'Paste & Send to WhatsApp';
            sendBtn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                await sendToWhatsApp(getElementTextWithoutButtons(tag), false, sendBtn, true);
            };
            actionRow.appendChild(pasteBtn);
            actionRow.appendChild(sendBtn);
            tag.parentNode.insertBefore(actionRow, tag.nextSibling);
        });

        // 3. Auto-detect Google answer containers/featured snippets and put a direct "📋 Send Answer" button
        const snippetSelectors = [
            '.hgKElc',          // Featured snippet summary
            '.LGOjbe',          // Translate card or specific definitions
            'div.ujudUb',       // Lyrics lines / accordion lines
            '.kp-hc',           // Knowledge Graph card titles
            '.kp-blk',          // Fact boxes
            '.O83Yf'            // Directly answered instant values
        ];
        
        snippetSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                if (element.querySelector('.quick-copy-btn') || element.closest('#tb-selection-send')) return;
                
                element.classList.add('game-snippet-answered');
                
                const actionRow = document.createElement('span');
                actionRow.className = 'quick-copy-row';
                actionRow.style.cssText = "margin-bottom: 6px;";
                const pasteBtn = document.createElement('span');
                pasteBtn.innerHTML = '📥';
                pasteBtn.className = 'quick-copy-btn';
                pasteBtn.style.cssText = "font-weight: bold; background: #3b82f6; color: white; padding: 3px 8px;";
                pasteBtn.title = 'Paste to WhatsApp (no send)';
                pasteBtn.onclick = async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    await sendToWhatsApp(getElementTextWithoutButtons(element), false, pasteBtn, false);
                };
                const sendBtn = document.createElement('span');
                sendBtn.innerHTML = '✅';
                sendBtn.className = 'quick-copy-btn';
                sendBtn.style.cssText = "font-weight: bold; background: #34a853; color: white; padding: 3px 8px;";
                sendBtn.title = 'Paste & Send to WhatsApp';
                sendBtn.onclick = async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    await sendToWhatsApp(getElementTextWithoutButtons(element), false, sendBtn, true);
                };
                actionRow.appendChild(pasteBtn);
                actionRow.appendChild(sendBtn);
                element.insertBefore(actionRow, element.firstChild);
            });
        });
    };

        let selectionBtn = null;
        let ctrlRangeStart = null;
        function removeSelectionBtn() {
          if (selectionBtn && selectionBtn.parentNode) {
            selectionBtn.parentNode.removeChild(selectionBtn);
          }
          selectionBtn = null;
        }

        function getSelectedText() {
          const sel = window.getSelection();
          if (!sel) return '';
          return (sel.toString() || '').replace(/\s+/g, ' ').trim();
        }

        function caretFromPoint(x, y) {
          if (typeof document.caretPositionFromPoint === 'function') {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos && pos.offsetNode) {
              return { node: pos.offsetNode, offset: pos.offset };
            }
          }
          if (typeof document.caretRangeFromPoint === 'function') {
            const range = document.caretRangeFromPoint(x, y);
            if (range && range.startContainer) {
              return { node: range.startContainer, offset: range.startOffset };
            }
          }
          return null;
        }

        function isForwardPoint(a, b) {
          if (a.node === b.node) return a.offset <= b.offset;
          const pos = a.node.compareDocumentPosition(b.node);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return true;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return false;
          return true;
        }

        async function sendCtrlClickRange(endPoint) {
          if (!ctrlRangeStart || !ctrlRangeStart.node || !endPoint || !endPoint.node) {
            return;
          }
          if (!ctrlRangeStart.node.isConnected || !endPoint.node.isConnected) {
            ctrlRangeStart = null;
            return;
          }

          const start = ctrlRangeStart;
          ctrlRangeStart = null;

          const range = document.createRange();
          const forward = isForwardPoint(start, endPoint);
          if (forward) {
            range.setStart(start.node, start.offset);
            range.setEnd(endPoint.node, endPoint.offset);
          } else {
            range.setStart(endPoint.node, endPoint.offset);
            range.setEnd(start.node, start.offset);
          }

          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }

          const picked = (range.toString() || '').replace(/\s+/g, ' ').trim();
          if (picked) {
            await sendSelectionToWhatsApp(false);
          }
        }

        function showSelectionBtn() {
          const text = getSelectedText();
          if (!text || text.length < 3) {
            removeSelectionBtn();
            return;
          }

          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) {
            removeSelectionBtn();
            return;
          }

          const rect = sel.getRangeAt(0).getBoundingClientRect();
          if (!rect || (!rect.width && !rect.height)) {
            removeSelectionBtn();
            return;
          }

          if (!selectionBtn) {
            selectionBtn = document.createElement('button');
            selectionBtn.id = 'tb-selection-send';
            selectionBtn.type = 'button';
            selectionBtn.textContent = 'Send to WhatsApp';
            selectionBtn.addEventListener('mousedown', (e) => {
              e.preventDefault();
              e.stopPropagation();
            });
            selectionBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await sendSelectionToWhatsApp(false);
              removeSelectionBtn();
            });
            document.body.appendChild(selectionBtn);
          }

          const top = rect.bottom + window.scrollY + 6;
          const left = Math.max(8, rect.right + window.scrollX);
          selectionBtn.style.top = top + 'px';
          selectionBtn.style.left = left + 'px';
        }

    const observer = new MutationObserver(() => { addCopyIcons(); });
    observer.observe(document.body, { childList: true, subtree: true });
    addCopyIcons();

    document.addEventListener('mouseup', () => {
      setTimeout(showSelectionBtn, 0);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
        setTimeout(showSelectionBtn, 0);
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (selectionBtn && !selectionBtn.contains(e.target)) {
        removeSelectionBtn();
      }
    });

    document.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;

      const point = caretFromPoint(e.clientX, e.clientY);
      if (!point) return;

      e.preventDefault();
      e.stopPropagation();

      if (!ctrlRangeStart) {
        ctrlRangeStart = point;
        return;
      }

      sendCtrlClickRange(point);
    }, true);

    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        const picked = getSelectedText();
        if (picked) {
          e.preventDefault();
          sendSelectionToWhatsApp(false);
          removeSelectionBtn();
        }
        return;
      }
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
      // Image search: opens Google in a visible tab and does exactly what a human
      // does — focus the search box, PASTE the image (Ctrl+V), type the suffix,
      // and press Enter. One combined (image + suffix) search. Pasting (vs file
      // upload) keeps the image attached when submitting.
      await p.exposeFunction("__tb_openLensTab", async (query) => {
        let newPage;
        try {
          newPage = await context.newPage();
          // Foreground is required so the clipboard paste reads the image.
          await newPage.bringToFront();
          await newPage.goto("https://www.google.com/?olu", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          });

          const hasQuery = !!(query && query.trim());

          // Focus the search box and paste the image that's on the clipboard.
          const box = newPage
            .locator('textarea[name="q"], input[name="q"]')
            .first();
          await box.click({ timeout: 10_000 });
          await newPage.keyboard.press("Control+V");

          // Wait until the pasted image's thumbnail actually appears (usually well
          // under 400ms) instead of always sleeping. Capped at 400ms so this is
          // never slower than a blind wait even if the markup changes.
          await newPage
            .locator('img[src^="blob:"], img[src^="data:"]')
            .first()
            .waitFor({ state: "visible", timeout: 400 })
            .catch(() => {});

          if (hasQuery) {
            // insertText drops the whole suffix in at once (not key-by-key) into
            // the still-focused composer box.
            await newPage.keyboard.insertText(query.trim());
            // Brief settle so the box registers the text before submitting.
            await newPage.waitForTimeout(100);
          }
          // Submit. The composer can steal focus while the image attaches, so the
          // Enter sometimes lands on nothing. Re-focus the box and retry until we
          // actually navigate to the results page.
          for (let i = 0; i < 3; i++) {
            try {
              await box.click({ timeout: 1_500 });
            } catch (_) {
              /* box may have re-rendered; press Enter on whatever is focused */
            }
            await newPage.keyboard.press("Enter");
            try {
              await newPage.waitForURL(/\/search\?/, { timeout: 2_500 });
              break;
            } catch (_) {
              /* not submitted yet — re-focus and try again */
            }
          }
        } catch (err) {
          // On failure, reveal whatever Lens has so the user isn't stuck.
          if (newPage) await newPage.bringToFront().catch(() => {});
          console.error(`[${ts()}] Failed to open Lens tab: ${err.message}`);
        }
      });
    } catch (_) {
      /* already exposed */
    }
    try {
      await p.exposeFunction(
        "__tb_copyDone",
        async (explicitText, closeTabAfter, shouldSend) => {
          try {
            await page.bringToFront();
            // Focus the message input using JS focus() — avoids dispatching pointer events
            // that could accidentally click the 🔍 image search buttons in the chat area.
            await page.evaluate(() => {
              const el = document.querySelector(
                "#main footer div[contenteditable]",
              );
              if (el) el.focus();
            });
            if (explicitText && String(explicitText).trim()) {
              const text = String(explicitText)
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .replace(/\u00A0/g, " ")
                .replace(/\s*,\s*/g, ", ")
                .replace(/\s+/g, " ")
                .trim();
              // Write to WhatsApp page's own clipboard and Control+v to ensure perfect, lossless paste
              await page.evaluate(async (t) => {
                try {
                  await navigator.clipboard.writeText(t);
                } catch (_) {}
              }, text);
              await page.keyboard.press("Control+v");
              if (shouldSend) {
                await page.keyboard.press("Enter");
              }
            } else {
              // Paste clipboard content (selection / Ctrl+range) — then send
              await page.keyboard.press("Control+v");
              await page.keyboard.press("Enter");
            }
            if (closeTabAfter) {
              // Delay closing slightly so the active paste has finished writing to the input field
              setTimeout(async () => {
                try {
                  await p.close();
                } catch (_) {}
              }, 100);
            }
          } catch (err) {
            console.error(
              `[${ts()}] WhatsApp focus/paste failed: ${err.message}`,
            );
          }
        },
      );
    } catch (_) {
      /* already exposed */
    }
    try {
      await p.exposeFunction("__tb_closeOtherTabs", async () => {
        try {
          const allPages = context.pages();
          for (const pg of allPages) {
            if (pg !== page) {
              try {
                await pg.close();
              } catch (_) {}
            }
          }
        } catch (_) {}
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
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: ["--start-maximized"],
    viewport: null,
    permissions: ["clipboard-read", "clipboard-write"],
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
