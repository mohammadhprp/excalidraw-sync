/**
 * Panel CSS — Excalidraw-native, polished-minimal, light + dark.
 *
 * Every selector is prefixed `ex-` and lives inside the shadow root, so
 * excalidraw.com's ~70 unscoped global selectors cannot reach the panel and the
 * panel's rules cannot leak onto the page. The palette follows the page theme
 * toggled by an `ex-dark` class on `.ex-root` (from
 * `localStorage["excalidraw-theme"]`).
 */

export const PANEL_CSS = `
:host { color-scheme: light dark; }

.ex-root {
  --ex-bg: #ffffff;
  --ex-surface: #f8f9fa;
  --ex-surface-2: #f1f3f5;
  --ex-border: #e9ecef;
  --ex-border-strong: #ced4da;
  --ex-text: #1b1b1f;
  --ex-muted: #868e96;
  --ex-accent: #6965db;
  --ex-accent-hover: #5b57d1;
  --ex-accent-fg: #ffffff;
  --ex-green: #2f9e44;
  --ex-amber: #f08c00;
  --ex-red: #e03131;
  --ex-grey: #adb5bd;
  --ex-radius: 10px;
  --ex-radius-sm: 8px;
  --ex-s1: 4px; --ex-s2: 8px; --ex-s3: 12px; --ex-s4: 16px;
  /* Fixed panel height: identical across tabs; the tab body scrolls instead.
     Keep in sync with PANEL_DEFAULT_HEIGHT in panel.ts. */
  --ex-panel-height: 560px;
  --ex-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --ex-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --ex-shadow: 0 10px 32px rgba(15, 15, 20, 0.18), 0 1px 2px rgba(15, 15, 20, 0.08);
  font-family: var(--ex-font);
  color: var(--ex-text);
  font-size: 13px;
  line-height: 1.45;
}
.ex-root.ex-dark {
  --ex-bg: #232329;
  --ex-surface: #2e2e36;
  --ex-surface-2: #36363f;
  --ex-border: #3d3d45;
  --ex-border-strong: #4a4a54;
  --ex-text: #ced4da;
  --ex-muted: #9a9a9a;
  --ex-accent: #a8a5ff;
  --ex-accent-hover: #b8b5ff;
  --ex-accent-fg: #1b1b1f;
  --ex-green: #69db7c;
  --ex-amber: #ffd43b;
  --ex-red: #ff6b6b;
  --ex-grey: #6b6b74;
  --ex-shadow: 0 12px 36px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
}
.ex-root *, .ex-root *::before, .ex-root *::after { box-sizing: border-box; }
/* The hidden attribute must beat the layout display rules on our own classes. */
.ex-root [hidden] { display: none; }

/* Launcher ---------------------------------------------------------------- */
.ex-launcher {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: var(--ex-s2);
  padding: 8px 14px 8px 10px;
  border: 1px solid var(--ex-border);
  border-radius: 999px;
  background: var(--ex-bg);
  color: var(--ex-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--ex-shadow);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: border-color 0.12s ease, transform 0.12s ease;
}
.ex-launcher:hover { border-color: var(--ex-accent); }
.ex-launcher:active { transform: translateY(1px); }
.ex-launcher.ex-dragging { cursor: grabbing; transform: none; }
.ex-launcher-mark {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--ex-accent);
  color: var(--ex-accent-fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.ex-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ex-grey);
  flex: none;
}
.ex-dot.tone-green { background: var(--ex-green); }
.ex-dot.tone-amber { background: var(--ex-amber); }
.ex-dot.tone-red { background: var(--ex-red); }
.ex-dot.tone-grey { background: var(--ex-grey); }

/* Panel shell ------------------------------------------------------------- */
.ex-panel {
  position: fixed;
  right: 16px;
  bottom: 64px;
  z-index: 2147483000;
  width: 360px;
  max-width: calc(100vw - 32px);
  /* Fixed height (not a content-hugging max-height): the header + tab bar stay
     put and the active tab panel scrolls. Clamped to the viewport by an inline
     max-height from placePanel so it always fits on-screen. */
  height: var(--ex-panel-height);
  max-height: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius);
  background: var(--ex-bg);
  color: var(--ex-text);
  box-shadow: var(--ex-shadow);
  overflow: hidden;
}
.ex-panel[hidden] { display: none; }
.ex-panel:focus-visible,
.ex-root button:focus-visible,
.ex-root input:focus-visible,
.ex-root select:focus-visible,
.ex-root textarea:focus-visible {
  outline: 2px solid var(--ex-accent);
  outline-offset: 1px;
}

/* Persistent header ------------------------------------------------------- */
.ex-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--ex-s2);
  padding: var(--ex-s3) var(--ex-s3) 10px;
  border-bottom: 1px solid var(--ex-border);
}
.ex-header-text { min-width: 0; flex: 1 1 auto; }
.ex-logo {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex: none;
  display: block;
  object-fit: contain;
}
.ex-header-board {
  font-weight: 650;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ex-header-sub {
  margin-top: 1px;
  font-size: 11px;
  color: var(--ex-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ex-status-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid var(--ex-border);
  border-radius: 999px;
  background: var(--ex-surface);
  font-size: 11px;
  font-weight: 600;
  color: var(--ex-muted);
  white-space: nowrap;
}
.ex-status-badge.tone-green { color: var(--ex-green); }
.ex-status-badge.tone-amber { color: var(--ex-amber); }
.ex-status-badge.tone-red { color: var(--ex-red); }
.ex-close {
  flex: none;
  border: none;
  background: transparent;
  color: var(--ex-muted);
  font: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.ex-close:hover { background: var(--ex-surface); color: var(--ex-text); }

/* Notice ------------------------------------------------------------------ */
.ex-notice {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: var(--ex-s2);
  margin: 10px var(--ex-s3) 0;
  padding: var(--ex-s2) 10px;
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  font-size: 12px;
}
.ex-notice.error { border-color: var(--ex-red); color: var(--ex-red); }
.ex-notice[hidden] { display: none; }
.ex-notice-text { flex: 1 1 auto; min-width: 0; }

/* Tabs -------------------------------------------------------------------- */
.ex-tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: var(--ex-s2) var(--ex-s3) 0;
  border-bottom: 1px solid var(--ex-border);
}
.ex-tab {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ex-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 10px 8px;
  margin-bottom: -1px;
  cursor: pointer;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
}
.ex-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ex-amber);
  flex: none;
}
.ex-tab:hover { color: var(--ex-text); background: var(--ex-surface); }
.ex-tab[aria-selected="true"] {
  color: var(--ex-accent);
  border-bottom-color: var(--ex-accent);
}

/* Panels ------------------------------------------------------------------ */
.ex-tabpanels { flex: 1 1 auto; min-height: 0; display: flex; }
.ex-tabpanel {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--ex-s4) var(--ex-s3) var(--ex-s3);
}
.ex-tabpanel[hidden] { display: none; }
.ex-tabpanel:focus { outline: none; }

.ex-section-title {
  margin: 0 0 var(--ex-s2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ex-muted);
}
/* A section heading with a trailing secondary control (e.g. Refresh). */
.ex-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ex-s2);
  margin: 0 0 var(--ex-s2);
}
.ex-section-head .ex-section-title { margin: 0; }
.ex-divider { height: 1px; background: var(--ex-border); margin: var(--ex-s3) 0; }

/* Buttons ----------------------------------------------------------------- */
.ex-root button {
  font-family: inherit;
}
.ex-btn, .ex-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--ex-border-strong);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-bg);
  color: var(--ex-text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}
.ex-btn:hover:not(:disabled), .ex-primary:hover:not(:disabled) { border-color: var(--ex-accent); }
.ex-primary {
  background: var(--ex-accent);
  border-color: var(--ex-accent);
  color: var(--ex-accent-fg);
}
.ex-primary:hover:not(:disabled) { background: var(--ex-accent-hover); border-color: var(--ex-accent-hover); }
.ex-btn:disabled, .ex-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.ex-btn.block, .ex-primary.block { width: 100%; }
.ex-btn-row { display: flex; gap: var(--ex-s2); align-items: center; }
.ex-btn-row.wrap { flex-wrap: wrap; }
.ex-link {
  border: none;
  background: transparent;
  color: var(--ex-accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
}
.ex-link:hover { text-decoration: underline; }

.ex-spinner {
  display: none;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ex-spin 0.7s linear infinite;
}
.ex-btn.ex-loading .ex-spinner, .ex-primary.ex-loading .ex-spinner { display: inline-block; }
@keyframes ex-spin { to { transform: rotate(360deg); } }

.ex-action-error {
  margin-top: var(--ex-s2);
  font-size: 12px;
  color: var(--ex-red);
}
.ex-action-error[hidden] { display: none; }

/* Cards & meta ------------------------------------------------------------ */
.ex-card {
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  padding: 10px 12px;
}
.ex-card + .ex-card { margin-top: var(--ex-s2); }
.ex-board-card { display: flex; flex-direction: column; gap: var(--ex-s2); }
.ex-meta { margin-top: 6px; font-size: 11px; color: var(--ex-muted); font-family: var(--ex-mono); }
.ex-card > .ex-meta:first-child { margin-top: 0; }
.ex-muted { color: var(--ex-muted); }
.ex-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.ex-row { display: flex; align-items: center; gap: var(--ex-s2); }
.ex-row + .ex-row { margin-top: 6px; }
.ex-grow { flex: 1 1 auto; min-width: 0; }

/* Inputs ------------------------------------------------------------------ */
.ex-field { display: flex; flex-direction: column; gap: 4px; }
/* Stacked fields share one vertical rhythm. */
.ex-root .ex-field + .ex-field { margin-top: var(--ex-s2); }
.ex-field > label { font-size: 11px; font-weight: 600; color: var(--ex-muted); }
.ex-input, .ex-root select, .ex-root textarea {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--ex-border-strong);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-bg);
  color: var(--ex-text);
  font: inherit;
  font-size: 12px;
}
.ex-root select { appearance: auto; }
.ex-root textarea { resize: vertical; min-height: 44px; }
.ex-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ex-s2); }
/* Two-column rows: the grid gap already spaces the columns, so the second
   field must not also inherit the stacked-field margin, which would push the
   right column ~8px below the left. Both columns align at the top instead. */
.ex-root .ex-grid > .ex-field { margin-top: 0; }
/* Adjacent form blocks (a grid, or a standalone field between two grids) share
   the same spacing as stacked fields. */
.ex-root .ex-grid + .ex-grid,
.ex-root .ex-grid + .ex-field,
.ex-root .ex-field + .ex-grid { margin-top: var(--ex-s2); }
.ex-check { display: flex; align-items: center; gap: var(--ex-s2); font-size: 12px; }
.ex-check input { width: auto; flex: none; }

/* Collection / board navigator ------------------------------------------- */
.ex-list { display: flex; flex-direction: column; gap: var(--ex-s2); margin-top: var(--ex-s2); }
.ex-collection-row {
  display: flex;
  align-items: center;
  gap: var(--ex-s2);
  min-height: 36px;
  padding: 4px 6px 4px 8px;
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-bg);
}
.ex-collection-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--ex-s2);
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ex-text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.ex-collection-toggle:hover { color: var(--ex-accent); }
.ex-chevron {
  flex: none;
  width: 12px;
  color: var(--ex-muted);
  font-size: 11px;
  line-height: 1;
}
.ex-collection-name { min-width: 0; }
.ex-collection-count {
  flex: none;
  font-size: 11px;
  color: var(--ex-muted);
  white-space: nowrap;
}
.ex-collection-boards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-left: var(--ex-s3);
  border-left: 2px solid var(--ex-border);
}
.ex-board-row {
  display: flex;
  align-items: center;
  gap: var(--ex-s2);
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-bg);
}
.ex-board-nested { min-height: 32px; padding: 4px 6px 4px 8px; }
.ex-board-active { border-color: var(--ex-accent); background: var(--ex-surface); }
.ex-board-open {
  appearance: none;
  min-width: 0;
  padding: 2px 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ex-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ex-board-open:hover { color: var(--ex-accent); text-decoration: underline; }
.ex-board-active .ex-board-open { color: var(--ex-accent); font-weight: 600; }

/* Compact destructive control (board + collection delete). */
.ex-del {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ex-muted);
  cursor: pointer;
}
.ex-del:hover:not(:disabled) {
  color: var(--ex-red);
  border-color: var(--ex-red);
  background: var(--ex-surface);
}

/* Conflict banner --------------------------------------------------------- */
.ex-conflict {
  margin-top: var(--ex-s2);
  padding: var(--ex-s2) 10px;
  border: 1px solid var(--ex-amber);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  font-size: 12px;
}
.ex-conflict[hidden] { display: none; }
.ex-conflict strong { display: block; margin-bottom: 6px; }

/* Needs setup + token help ------------------------------------------------ */
.ex-setup-banner {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: var(--ex-s3);
  padding: var(--ex-s2) 10px;
  border: 1px solid var(--ex-amber);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  font-size: 12px;
}
.ex-setup-banner[hidden] { display: none; }
.ex-setup-missing { color: var(--ex-muted); }
.ex-hint {
  margin-top: var(--ex-s2);
  padding: 10px;
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  font-size: 12px;
}
.ex-hint[hidden] { display: none; }
.ex-hint ol { margin: 0 0 6px; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.ex-hint p { margin: 0; font-size: 11px; }

/* Confirm modal ----------------------------------------------------------- */
.ex-confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 15, 20, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ex-s4);
}
.ex-confirm-overlay[hidden] { display: none; }
.ex-confirm {
  width: 100%;
  background: var(--ex-bg);
  border: 1px solid var(--ex-border);
  border-radius: var(--ex-radius);
  padding: var(--ex-s3);
}
.ex-confirm p { margin: 0 0 var(--ex-s3); font-size: 12px; }
.ex-confirm .ex-field { margin-bottom: var(--ex-s3); }

/* First-run: Get started card + checklist --------------------------------- */
/* Single-class selectors keep these below the .ex-root [hidden] rule (0,2,0),
   so the hidden attribute still wins without an explicit companion. */
.ex-get-started {
  display: flex;
  flex-direction: column;
  gap: var(--ex-s2);
  border-color: var(--ex-accent);
  background: var(--ex-bg);
}
.ex-get-started-title { margin: 0; font-size: 14px; font-weight: 700; }
.ex-get-started-lede { margin: 0; font-size: 12px; color: var(--ex-muted); }
.ex-checklist {
  list-style: none;
  margin: var(--ex-s1) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.ex-check-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--ex-s2);
  padding-bottom: var(--ex-s3);
}
.ex-check-item:last-child { padding-bottom: 0; }
/* Connector from each marker down to the next step. */
.ex-check-item:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 18px;
  bottom: 0;
  width: 2px;
  background: var(--ex-border-strong);
}
.ex-check-item.done:not(:last-child)::before { background: var(--ex-green); }
.ex-check-marker {
  position: relative;
  z-index: 1;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--ex-border-strong);
  background: var(--ex-bg);
  color: var(--ex-accent-fg);
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.ex-check-item.done .ex-check-marker {
  border-color: var(--ex-green);
  background: var(--ex-green);
}
.ex-check-item.current .ex-check-marker { border-color: var(--ex-accent); }
.ex-check-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding-top: 1px; }
.ex-check-label { font-size: 12px; font-weight: 600; }
.ex-check-item.current .ex-check-label { color: var(--ex-accent); }
.ex-check-item.done .ex-check-label { color: var(--ex-muted); font-weight: 500; }
.ex-check-desc { font-size: 11px; color: var(--ex-muted); }

/* First-run empty states -------------------------------------------------- */
.ex-empty-state {
  border: 1px dashed var(--ex-border-strong);
  border-radius: var(--ex-radius-sm);
  background: var(--ex-surface);
  padding: var(--ex-s3);
}
.ex-empty-state .ex-section-title { color: var(--ex-text); }
/* The section's leading divider belongs outside the dashed empty-state box. */
.ex-empty-state > .ex-divider { display: none; }
.ex-empty-hint { margin: 0 0 var(--ex-s2); font-size: 12px; color: var(--ex-muted); }
`;
