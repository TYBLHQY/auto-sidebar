import { Plugin } from "obsidian";

interface Store {
  leftCompact: boolean;
  rightCompact: boolean;
  leftWidth: number;
  rightWidth: number;
}

const HOVER_ZONE_PX = 8;   // pixels from window edge to trigger overlay
const HIDE_DELAY_MS = 400;  // ms before auto-hiding after mouse leaves

export default class AutoSidebarPlugin extends Plugin {
  private leftCompact = false;
  private rightCompact = false;
  private leftWidth = 270;
  private rightWidth = 270;

  private listenerActive = false;
  private hideTimers: Record<string, ReturnType<typeof setTimeout> | null> = {
    left: null,
    right: null,
  };

  /* ================================================================
     LIFECYCLE
     ================================================================ */

  async onload(): Promise<void> {
    const data = await this.loadData();
    if (data) {
      this.leftCompact = (data as Store).leftCompact ?? false;
      this.rightCompact = (data as Store).rightCompact ?? false;
      this.leftWidth = (data as Store).leftWidth ?? 270;
      this.rightWidth = (data as Store).rightWidth ?? 270;
    }

    this.addCommand({
      id: "toggle-left-compact",
      name: "Toggle left compact mode",
      callback: () => this.toggle("left"),
    });
    this.addCommand({
      id: "toggle-right-compact",
      name: "Toggle right compact mode",
      callback: () => this.toggle("right"),
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.leftCompact) this.doCompact("left");
      if (this.rightCompact) this.doCompact("right");
    });
  }

  onunload(): void {
    this.cleanupSide("left");
    this.cleanupSide("right");
    this.syncListener();
  }

  /* ================================================================
     TOGGLE
     ================================================================ */

  private toggle(side: "left" | "right"): void {
    const compact = this.compactState(side);
    if (compact) {
      this.uncompact(side);
    } else {
      this.doCompact(side);
    }
  }

  /* ================================================================
     ENTER / EXIT COMPACT MODE
     ================================================================ */

  private doCompact(side: "left" | "right"): void {
    const split = this.splitAPI(side);
    if (!split) return;

    // Ensure sidebar is in expanded (not icon‑only) layout state
    split.expand();

    requestAnimationFrame(() => {
      const el = this.splitEl(side);
      if (!el) return;

      // Capture the user-adjusted NCM width
      const w = el.getBoundingClientRect().width;
      if (w > 10) this.setWidth(side, w);

      // Collapse to zero
      this.hide(el);

      this.setCompact(side, true);
      this.syncListener();
      this.persist();
    });
  }

  private uncompact(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (el) {
      el.classList.remove("auto-sidebar-overlay");
      this.show(el);
    }

    this.setCompact(side, false);
    this.syncListener();
    this.persist();
  }

  /* ================================================================
     OVERLAY SHOW / HIDE (compact-mode only)
     ================================================================ */

  private revealOverlay(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el || el.classList.contains("auto-sidebar-overlay")) return;

    const split = this.splitAPI(side);
    if (split?.collapsed) split.expand();

    // Remove hiding overrides so the element can take its natural size
    el.style.removeProperty("flex-basis");
    el.style.removeProperty("min-width");
    el.style.overflow = "";

    // Float above content
    el.classList.add("auto-sidebar-overlay");

    // Explicit width for absolutely-positioned overlay
    const w = this.widthOf(side);
    el.style.setProperty("width", w + "px", "important");
  }

  private concealOverlay(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el || !el.classList.contains("auto-sidebar-overlay")) return;

    el.classList.remove("auto-sidebar-overlay");
    this.hide(el);
  }

  /* ================================================================
     HOVER DETECTION
     ================================================================ */

  private onMouseMove = (e: MouseEvent): void => {
    const x = e.clientX;
    if (this.leftCompact) this.edgeCheck("left", x, e.clientY);
    if (this.rightCompact) this.edgeCheck("right", x, e.clientY);
  };

  private edgeCheck(side: "left" | "right", x: number, y: number): void {
    const el = this.splitEl(side);
    if (!el) return;

    const showing = el.classList.contains("auto-sidebar-overlay");
    const nearEdge =
      side === "left"
        ? x <= HOVER_ZONE_PX
        : x >= window.innerWidth - HOVER_ZONE_PX;

    if (nearEdge && !showing) {
      this.clearTimer(side);
      this.revealOverlay(side);
      return;
    }

    if (!showing) return;

    // Overlay is visible — keep it open while pointer is on it
    if (this.pointerIn(el, x, y)) {
      this.clearTimer(side);
    } else if (!nearEdge) {
      this.startTimer(side);
    }
  }

  private pointerIn(el: HTMLElement, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private startTimer(side: "left" | "right"): void {
    if (this.hideTimers[side] !== null) return;
    this.hideTimers[side] = setTimeout(() => {
      this.concealOverlay(side);
      this.hideTimers[side] = null;
    }, HIDE_DELAY_MS);
  }

  private clearTimer(side: "left" | "right"): void {
    if (this.hideTimers[side] !== null) {
      clearTimeout(this.hideTimers[side]!);
      this.hideTimers[side] = null;
    }
  }

  private syncListener(): void {
    const should = this.leftCompact || this.rightCompact;
    if (should && !this.listenerActive) {
      document.addEventListener("mousemove", this.onMouseMove);
      this.listenerActive = true;
    } else if (!should && this.listenerActive) {
      document.removeEventListener("mousemove", this.onMouseMove);
      this.listenerActive = false;
    }
  }

  /* ================================================================
     STYLE HELPERS
     ================================================================ */

  /** Hide the sidebar — only flex-basis & min-width, never touch width.
   *  Obsidian's resize handle sets `width` via setSize() internally.
   *  In flex row layout, flex-basis overrides width, so setting
   *  flex-basis to 0 is enough to collapse it while preserving the
   *  original width value for NCM restore. */
  private hide(el: HTMLElement): void {
    el.style.setProperty("flex-basis", "0px", "important");
    el.style.setProperty("min-width", "0px", "important");
    el.style.overflow = "hidden";
  }

  /** Restore the sidebar to NCM — remove our overrides, let Obsidian's
   *  inline width (from setSize) apply naturally. */
  private show(el: HTMLElement): void {
    el.style.removeProperty("flex-basis");
    el.style.removeProperty("min-width");
    el.style.overflow = "";
  }

  /* ================================================================
     PERSISTENCE
     ================================================================ */

  private persist(): void {
    this.saveData({
      leftCompact: this.leftCompact,
      rightCompact: this.rightCompact,
      leftWidth: this.leftWidth,
      rightWidth: this.rightWidth,
    } as Store);
  }

  /* ================================================================
     HELPERS
     ================================================================ */

  private splitAPI(side: "left" | "right"): any {
    return side === "left"
      ? (this.app.workspace as any).leftSplit
      : (this.app.workspace as any).rightSplit;
  }

  private splitEl(side: "left" | "right"): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      side === "left"
        ? ".workspace-split.mod-left-split"
        : ".workspace-split.mod-right-split",
    );
  }

  private widthOf(side: "left" | "right"): number {
    return side === "left" ? this.leftWidth : this.rightWidth;
  }

  private setWidth(side: "left" | "right", w: number): void {
    if (side === "left") this.leftWidth = w;
    else this.rightWidth = w;
  }

  private compactState(side: "left" | "right"): boolean {
    return side === "left" ? this.leftCompact : this.rightCompact;
  }

  private setCompact(side: "left" | "right", v: boolean): void {
    if (side === "left") this.leftCompact = v;
    else this.rightCompact = v;
  }

  private cleanupSide(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el) return;
    el.classList.remove("auto-sidebar-overlay");
    el.style.removeProperty("width");      // clean up overlay width
    el.style.removeProperty("flex-basis");
    el.style.removeProperty("min-width");
    el.style.overflow = "";
  }
}
