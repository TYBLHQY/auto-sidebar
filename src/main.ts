import { Plugin } from "obsidian";

/* ================================================================
   Constants
   ================================================================ */

interface PersistedData {
  leftCompact: boolean;
  leftWidth: number;
}

interface SplitContainer {
  collapsed: boolean;
  expand(): void;
  collapse(): void;
  containerEl: HTMLElement;
}

const HOVER_ZONE_PX = 8;
const HIDE_DELAY_MS = 150;
const DOC_LEAVE_DELAY_MS = 1000;
const SIDEBAR_BAIL_THRESHOLD_PX = 10;

/* ================================================================
   Auto Sidebar Plugin
   ================================================================ */

export default class AutoSidebarPlugin extends Plugin {
  private leftCompact = false;
  private leftWidth = 270;
  private listenerActive = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Obsidian's inline `width` before the plugin overrides it. */
  private obsidianWidth = "";

  /* ==============================================================
     LIFECYCLE
     ============================================================== */

  async onload(): Promise<void> {
    const data = await this.loadData();
    if (data) {
      this.leftCompact = (data as PersistedData).leftCompact ?? false;
      this.leftWidth = (data as PersistedData).leftWidth ?? 270;
    }

    this.addCommand({
      id: "toggle-left-compact",
      name: "Toggle compact mode",
      callback: () => this.toggle(),
    });

    this.app.workspace.onLayoutReady(() => this.restoreStartup());
  }

  onunload(): void {
    this.stripCMStyles();
    this.teardownListeners();
  }

  /* ==============================================================
     STARTUP RESTORE
     ============================================================== */

  private restoreStartup(): void {
    if (!this.leftCompact) return;

    // Apply CM styles directly using the persisted width — don't call
    // split.expand() first, which would flash the sidebar in NCM for a
    // frame before the rAF hides it.
    this.obsidianWidth = this.splitEl()?.style.width || "";
    this.applyCompactStyles(this.leftWidth);
  }

  /* ==============================================================
     ENTER / EXIT COMPACT MODE
     ============================================================== */

  private toggle(): void {
    if (this.leftCompact) {
      this.uncompact();
    } else {
      this.enterCompact();
    }
  }

  /** NCM → CM: expand, measure, apply compact styles. */
  private enterCompact(): void {
    const split = this.splitAPI();
    if (!split) return;
    split.expand();

    requestAnimationFrame(() => {
      const el = this.splitEl();
      if (!el) return;

      const w = el.getBoundingClientRect().width;

      // Layout not ready or collapsed via API — bail out
      if (w <= SIDEBAR_BAIL_THRESHOLD_PX) {
        this.leftCompact = false;
        this.persist();
        return;
      }

      this.leftWidth = w;
      this.obsidianWidth = el.style.width || "";
      this.applyCompactStyles(w);
    });
  }

  /** CM → NCM: remove positioning first, then expand via API. */
  private uncompact(): void {
    const el = this.splitEl();
    const split = this.splitAPI();
    if (!el) return;

    el.classList.remove("auto-sidebar-compact", "auto-sidebar-visible");

    el.style.removeProperty("width");
    el.style.width = this.obsidianWidth || `${this.leftWidth}px`;

    split?.expand();

    this.leftCompact = false;
    this.syncListener();
    this.persist();
  }

  /** Set inline width, add CM classes, sync state. */
  private applyCompactStyles(width: number): void {
    const el = this.splitEl();
    const split = this.splitAPI();
    if (!el) return;

    el.style.setProperty("width", `${width}px`, "important");
    el.classList.add("auto-sidebar-compact");
    this.leftCompact = true;
    this.syncListener();
    this.persist();

    // Sync Obsidian's native collapsed state: in CM the sidebar is
    // already off-screen, so collapse the split.  On next startup
    // Obsidian will restore it collapsed — the sidebar starts hidden
    // before the plugin even touches it, eliminating the flash.
    split?.collapse();
  }

  /* ==============================================================
     OVERLAY SHOW / HIDE  (hover-triggered, CM only)
     ============================================================== */

  private revealOverlay(): void {
    const el = this.splitEl();
    if (!el || el.classList.contains("auto-sidebar-visible")) return;

    const split = this.splitAPI();
    if (split?.collapsed) split.expand();

    el.style.setProperty("width", `${this.leftWidth}px`, "important");
    el.classList.add("auto-sidebar-visible");
  }

  private concealOverlay(): void {
    const el = this.splitEl();
    if (!el || !el.classList.contains("auto-sidebar-visible")) return;
    el.classList.remove("auto-sidebar-visible");
  }

  /* ==============================================================
     HOVER DETECTION
     ============================================================== */

  private onMouseMove = (e: MouseEvent): void => {
    if (this.leftCompact) this.edgeCheck(e.clientX, e.clientY);
  };

  private onDocumentLeave = (): void => {
    if (!this.leftCompact) return;
    const el = this.splitEl();
    if (!el?.classList.contains("auto-sidebar-visible")) return;
    if (this.leaveTimer !== null) return;
    this.leaveTimer = setTimeout(() => {
      this.concealOverlay();
      this.leaveTimer = null;
    }, DOC_LEAVE_DELAY_MS);
  };

  private onDocumentEnter = (): void => {
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  };

  private edgeCheck(x: number, y: number): void {
    const el = this.splitEl();
    if (!el) return;

    const showing = el.classList.contains("auto-sidebar-visible");
    const nearEdge = x <= HOVER_ZONE_PX;

    if (nearEdge) {
      if (!showing) {
        this.clearTimer();
        this.revealOverlay();
      }
      // If already showing while near the edge, do nothing
      return;
    }

    if (!showing) return;

    // Not near edge and showing: check if pointer is within sidebar
    if (this.pointerIn(el, x, y)) {
      this.clearTimer();
    } else {
      this.startHideTimer();
    }
  }

  private pointerIn(el: HTMLElement, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private startHideTimer(): void {
    if (this.hideTimer !== null) return;
    this.hideTimer = setTimeout(() => {
      this.concealOverlay();
      this.hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  private syncListener(): void {
    if (this.leftCompact && !this.listenerActive) {
      document.addEventListener("mousemove", this.onMouseMove, { passive: true });
      document.documentElement.addEventListener("mouseleave", this.onDocumentLeave);
      document.documentElement.addEventListener("mouseenter", this.onDocumentEnter);
      window.addEventListener("blur", this.onDocumentLeave);
      this.listenerActive = true;
    } else if (!this.leftCompact && this.listenerActive) {
      document.removeEventListener("mousemove", this.onMouseMove);
      document.documentElement.removeEventListener("mouseleave", this.onDocumentLeave);
      document.documentElement.removeEventListener("mouseenter", this.onDocumentEnter);
      window.removeEventListener("blur", this.onDocumentLeave);
      this.listenerActive = false;
    }
  }

  private teardownListeners(): void {
    if (!this.listenerActive) return;
    document.removeEventListener("mousemove", this.onMouseMove);
    document.documentElement.removeEventListener("mouseleave", this.onDocumentLeave);
    document.documentElement.removeEventListener("mouseenter", this.onDocumentEnter);
    window.removeEventListener("blur", this.onDocumentLeave);
    this.listenerActive = false;
  }

  /* ==============================================================
     PERSISTENCE
     ============================================================== */

  private persist(): void {
    this.saveData({
      leftCompact: this.leftCompact,
      leftWidth: this.leftWidth,
    });
  }

  /* ==============================================================
     HELPERS
     ============================================================== */

  private splitAPI(): SplitContainer | null {
    const split = (this.app.workspace as unknown as Record<string, unknown>).leftSplit;
    return (split as SplitContainer) ?? null;
  }

  private splitEl(): HTMLElement | null {
    return this.splitAPI()?.containerEl ?? null;
  }

  /** Strip CM classes and restore Obsidian's original width (plugin unload). */
  private stripCMStyles(): void {
    const el = this.splitEl();
    if (!el) return;

    el.classList.remove("auto-sidebar-compact", "auto-sidebar-visible");
    el.style.removeProperty("width");
    if (this.obsidianWidth) {
      el.style.width = this.obsidianWidth;
    }
  }
}
