"use strict";

/**
 * Notifier — desktop / console alerts for important bot events.
 *
 * Uses the Windows toast notification API (via PowerShell) when available,
 * falling back to a loud console banner so nothing is missed if notifications
 * are suppressed.
 */

const { execSync } = require("child_process");
const { createLogger } = require("./logger");

const log = createLogger("Notifier");

// ── Internal helpers ──────────────────────────────────────────────────────────

function consoleBanner(title, body, type = "info") {
  const line = "═".repeat(60);
  const colour =
    type === "success"
      ? "\x1b[32m"
      : type === "warn"
        ? "\x1b[33m"
        : type === "error"
          ? "\x1b[31m"
          : "\x1b[36m";
  console.log(`\n${colour}${line}`);
  console.log(`  ${title}`);
  if (body) console.log(`  ${body}`);
  console.log(`${line}\x1b[0m\n`);
}

/**
 * Fire a Windows toast notification via PowerShell.
 * Silently no-ops on non-Windows platforms.
 */
function windowsToast(title, body) {
  if (process.platform !== "win32") return;
  try {
    const escaped = (s) => s.replace(/'/g, "''").replace(/"/g, '`"');
    const ps = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
      `$template = "<toast><visual><binding template='ToastText02'><text id='1'>${escaped(title)}</text><text id='2'>${escaped(body)}</text></binding></visual></toast>"`,
      "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "$xml.LoadXml($template)",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
      '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("TicketBot").Show($toast)',
    ].join("; ");
    execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      stdio: "ignore",
      timeout: 5_000,
    });
  } catch {
    // Notifications are optional — ignore all errors
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Notify that a ticket was successfully booked.
 * @param {string} [detail]
 */
function notifyTicketBooked(detail = "") {
  const title = "🎟️  Ticket Booked!";
  const body = detail || "Book Tickets was clicked successfully.";
  consoleBanner(title, body, "success");
  windowsToast(title, body);
  log.info(`BOOKED — ${body}`);
}

/**
 * Notify that tickets went on sale (button appeared).
 */
function notifyTicketsOnSale() {
  const title = "🚨 Tickets On Sale!";
  const body = "Book Tickets button detected — attempting purchase…";
  consoleBanner(title, body, "warn");
  windowsToast(title, body);
  log.warn(body);
}

/**
 * Notify about a generic error that may need attention.
 * @param {string} message
 */
function notifyError(message) {
  consoleBanner("❌ Error", message, "error");
  windowsToast("TicketBot Error", message);
  log.error(message);
}

/**
 * Simple info notification (console only).
 * @param {string} title
 * @param {string} [body]
 */
function notifyInfo(title, body = "") {
  consoleBanner(title, body, "info");
  log.info(`${title} ${body}`);
}

module.exports = {
  notifyTicketBooked,
  notifyTicketsOnSale,
  notifyError,
  notifyInfo,
};
