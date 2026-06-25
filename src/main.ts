import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

interface Store {
  leftCompact: boolean;
  rightCompact: boolean;
  leftWidth: number;
  rightWidth: number;
  leftDisabled: boolean;
  rightDisabled: boolean;
}

const HOVER_ZONE_PX = 8;
const HIDE_DELAY_MS = 150;      // sidebar-keep-hover.duration (Zen default 150)
const DOC_LEAVE_DELAY_MS = 1000; // toolbar-hide-after-hover.duration (Zen default 1000)
const SHOW_SPRING_MS = 250;
const HIDE_SMOOTH_MS = 150;
const SIZE_ANIM_MS = 200;

/** Overshoot spring for reveal (peak ~101%, Zen‑style) */
const SHOW_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** Smooth ease-out for hide */
const HIDE_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";

export default class AutoSidebarPlugin extends Plugin {
  private leftCompact = false;
  private rightCompact = false;
  private leftWidth = 270;
  private rightWidth = 270;

  /** Disabled — sidebar stays permanently collapsed/unexpandable */
  private leftDisabled = false;
  private rightDisabled = false;

  private listenerActive = false;
  private hideTimers: Record<string, ReturnType<typeof setTimeout> | null> = {
    left: null,
    right: null,
  };
  private leaveTimers: Record<string, ReturnType<typeof setTimeout> | null> = {
    left: null,
    right: null,
  };
  /** Obsidian's inline `width` before we overwrite it for overlay. */
  private obsidianWidth: Record<string, string> = { left: "", right: "" };

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
      this.leftDisabled = (data as Store).leftDisabled ?? false;
      this.rightDisabled = (data as Store).rightDisabled ?? false;
    }

    this.addSettingTab(new AutoSidebarSettingTab(this.app, this));

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
      // On startup: restore CM instantly without animation
      if (!this.leftDisabled && this.leftCompact) this.enterCompact("left", true);
      if (!this.rightDisabled && this.rightCompact) this.enterCompact("right", true);

      // If disabled, ensure sidebar is collapsed via Obsidian API
      if (this.leftDisabled) {
        const split = this.splitAPI("left");
        if (split && !split.collapsed) split.collapse();
      }
      if (this.rightDisabled) {
        const split = this.splitAPI("right");
        if (split && !split.collapsed) split.collapse();
      }
    });
  }

  onunload(): void {
    this.cleanupSide("left");
    this.cleanupSide("right");
    this.teardownListeners();
  }

  /* ================================================================
     TOGGLE
     ================================================================ */

  private toggle(side: "left" | "right"): void {
    if (this.disabledState(side)) return;
    if (this.compactState(side)) {
      this.uncompact(side);
    } else {
      this.enterCompact(side, false);
    }
  }

  /* ================================================================
     ENTER COMPACT MODE  (NCM → CM)
     ================================================================ */

  private enterCompact(side: "left" | "right", instant: boolean): void {
    if (this.disabledState(side)) return;
    const split = this.splitAPI(side);
    if (!split) return;
    split.expand();

    requestAnimationFrame(() => {
      const el = this.splitEl(side);
      if (!el) return;

      const w = el.getBoundingClientRect().width;
      if (w > 10) this.setWidth(side, w);

      // Save Obsidian's inline width before we overwrite it
      this.obsidianWidth[side] = el.style.width || "";

      if (instant) {
        el.style.setProperty("width", w + "px", "important");
        el.classList.add("auto-sidebar-compact");
        this.setCompact(side, true);
        this.syncListener();
        this.persist();
        return;
      }

      // ── Animated: flex-basis shrink → absolute positioning ──

      // 1) Make flex-basis explicit so the browser can interpolate
      el.style.flexBasis = w + "px";

      // 2) Next frame: start shrink animation
      requestAnimationFrame(() => {
        el.classList.add("auto-sidebar-animate-size");
        el.classList.add("auto-sidebar-collapsed");

        // 3) After shrink completes, switch to absolute positioning
        setTimeout(() => {
          el.classList.remove("auto-sidebar-animate-size");
          el.classList.remove("auto-sidebar-collapsed");
          el.style.removeProperty("flex-basis");
          el.style.removeProperty("min-width");
          el.style.overflow = "";

          el.style.setProperty("width", w + "px", "important");
          el.classList.add("auto-sidebar-compact");

          this.setCompact(side, true);
          this.syncListener();
          this.persist();
        }, SIZE_ANIM_MS);
      });
    });
  }

  /* ================================================================
     EXIT COMPACT MODE  (CM → NCM)
     ================================================================ */

  private uncompact(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el) return;

    const split = this.splitAPI(side);
    const w = this.widthOf(side);

    // Ensure sidebar is expanded in Obsidian's API before we start
    // transitioning.  When position:absolute took the sidebar out of
    // flex flow, Obsidian may have marked the internal sidedock state
    // as "collapsed" — without expand() here, restoring flex layout
    // would give the sidebar zero width (only affects the right
    // sidebar in practice).
    if (split?.collapsed) split.expand();

    // 1) Slide the overlay into view
    el.style.setProperty("width", w + "px", "important");
    el.classList.add("auto-sidebar-compact");
    el.classList.add("auto-sidebar-animate-overlay");
    el.classList.add("auto-sidebar-visible");

    // 2) After slide-in completes, switch back to flex layout
    setTimeout(() => {
      el.classList.remove("auto-sidebar-animate-overlay");
      el.style.removeProperty("transition");

      // Switch from absolute → flex item
      el.classList.remove("auto-sidebar-compact");
      el.classList.remove("auto-sidebar-visible");

      // Restore width using the SAME property Obsidian's resize handle sets.
      // No !important — the user can still drag to resize.
      el.style.removeProperty("width");
      if (this.obsidianWidth[side]) {
        el.style.width = this.obsidianWidth[side];
      } else {
        el.style.width = w + "px";
      }
      // flex-basis intentionally NOT set — leave it at `auto` so it
      // reads from `width` and Obsidian's resize handle works.

      this.setCompact(side, false);
      this.persist();
      this.syncListener();
    }, SHOW_SPRING_MS);
  }

  /* ================================================================
     OVERLAY SHOW / HIDE  (CM only, hover-triggered)
     ================================================================ */

  private readonly showTransition = `transform ${SHOW_SPRING_MS}ms ${SHOW_EASE}`;
  private readonly hideTransition = `transform ${HIDE_SMOOTH_MS}ms ${HIDE_EASE}`;

  private revealOverlay(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el || el.classList.contains("auto-sidebar-visible")) return;

    const split = this.splitAPI(side);
    if (split?.collapsed) split.expand();

    // Ensure width is correct
    el.style.setProperty("width", this.widthOf(side) + "px", "important");

    // Trigger overlay slide-in with springy easing
    el.classList.add("auto-sidebar-animate-overlay");
    el.classList.add("auto-sidebar-visible");

    // Clean up after animation
    setTimeout(() => {
      el.classList.remove("auto-sidebar-animate-overlay");
    }, SHOW_SPRING_MS + 50);
  }

  private concealOverlay(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el || !el.classList.contains("auto-sidebar-visible")) return;

    // Override transition for smooth hide (different easing from show)
    el.style.transition = this.hideTransition;
    el.classList.remove("auto-sidebar-visible");

    // Clean up after animation
    setTimeout(() => {
      el.style.removeProperty("transition");
    }, HIDE_SMOOTH_MS + 50);
  }

  /* ================================================================
     HOVER DETECTION
     ================================================================ */

  /** Mouse left Obsidian's window entirely — start delayed hide. */
  private onDocumentLeave = (): void => {
    for (const side of ["left", "right"] as const) {
      if (!this.compactState(side)) continue;
      const el = this.splitEl(side);
      if (!el?.classList.contains("auto-sidebar-visible")) continue;
      if (this.leaveTimers[side] !== null) continue;
      this.leaveTimers[side] = setTimeout(() => {
        this.concealOverlay(side);
        this.leaveTimers[side] = null;
      }, DOC_LEAVE_DELAY_MS);
    }
  };

  /** Mouse re-entered the window — cancel pending hide. */
  private onDocumentEnter = (): void => {
    this.clearLeaveTimers();
  };

  /** Window lost focus (Alt+Tab, Win+Tab, Cmd+`) — trigger delayed hide. */
  private onWindowBlur = (): void => {
    this.onDocumentLeave();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.leftCompact) this.edgeCheck("left", e.clientX, e.clientY);
    if (this.rightCompact) this.edgeCheck("right", e.clientX, e.clientY);
  };

  private edgeCheck(side: "left" | "right", x: number, y: number): void {
    if (this.disabledState(side)) return;
    const el = this.splitEl(side);
    if (!el) return;

    const showing = el.classList.contains("auto-sidebar-visible");
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
    if (this.leaveTimers[side] !== null) {
      clearTimeout(this.leaveTimers[side]!);
      this.leaveTimers[side] = null;
    }
  }

  private clearLeaveTimers(): void {
    for (const side of ["left", "right"] as const) {
      if (this.leaveTimers[side] !== null) {
        clearTimeout(this.leaveTimers[side]!);
        this.leaveTimers[side] = null;
      }
    }
  }

  private syncListener(): void {
    const should = this.leftCompact || this.rightCompact;
    if (should && !this.listenerActive) {
      document.addEventListener("mousemove", this.onMouseMove);
      document.documentElement.addEventListener("mouseleave", this.onDocumentLeave);
      document.documentElement.addEventListener("mouseenter", this.onDocumentEnter);
      window.addEventListener("blur", this.onWindowBlur);
      this.listenerActive = true;
    } else if (!should && this.listenerActive) {
      document.removeEventListener("mousemove", this.onMouseMove);
      document.documentElement.removeEventListener("mouseleave", this.onDocumentLeave);
      document.documentElement.removeEventListener("mouseenter", this.onDocumentEnter);
      window.removeEventListener("blur", this.onWindowBlur);
      this.listenerActive = false;
    }
  }

  private teardownListeners(): void {
    if (!this.listenerActive) return;
    document.removeEventListener("mousemove", this.onMouseMove);
    document.documentElement.removeEventListener("mouseleave", this.onDocumentLeave);
    document.documentElement.removeEventListener("mouseenter", this.onDocumentEnter);
    window.removeEventListener("blur", this.onWindowBlur);
    this.listenerActive = false;
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
      leftDisabled: this.leftDisabled,
      rightDisabled: this.rightDisabled,
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

  private disabledState(side: "left" | "right"): boolean {
    return side === "left" ? this.leftDisabled : this.rightDisabled;
  }

  /** Enable/disable a sidebar.  When enabling disable, the sidebar is exited
   *  from CM (if active) and collapsed via the Obsidian API. */
  public setDisabled(side: "left" | "right", value: boolean): void {
    if (side === "left") this.leftDisabled = value;
    else this.rightDisabled = value;

    if (value) {
      // Exit CM immediately if active
      if (this.compactState(side)) {
        this.cleanupSide(side);
        this.setCompact(side, false);
      }

      // Collapse via Obsidian API — keeps sidebar closed in NCM
      const split = this.splitAPI(side);
      if (split && !split.collapsed) {
        split.collapse();
      }

      this.syncListener();
    }

    this.persist();
  }

  private setCompact(side: "left" | "right", v: boolean): void {
    if (side === "left") this.leftCompact = v;
    else this.rightCompact = v;
  }

  private cleanupSide(side: "left" | "right"): void {
    const el = this.splitEl(side);
    if (!el) return;
    el.classList.remove(
      "auto-sidebar-compact",
      "auto-sidebar-visible",
      "auto-sidebar-animate-overlay",
      "auto-sidebar-animate-size",
      "auto-sidebar-collapsed",
    );
    el.style.removeProperty("width");
    if (this.obsidianWidth[side]) {
      el.style.width = this.obsidianWidth[side];
    }
    el.style.removeProperty("flex-basis");
    el.style.removeProperty("min-width");
    el.style.removeProperty("transition");
    el.style.overflow = "";
  }
}

/* ================================================================
   SETTINGS TAB
   ================================================================ */

class AutoSidebarSettingTab extends PluginSettingTab {
  private plugin: AutoSidebarPlugin;

  constructor(app: App, plugin: AutoSidebarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Disable left sidebar")
      .setDesc(
        "Keep left sidebar permanently collapsed. Keyboard shortcuts, hover, and CM transitions will not expand it.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin["leftDisabled"])
          .onChange((value) => {
            this.plugin.setDisabled("left", value);
          }),
      );

    new Setting(containerEl)
      .setName("Disable right sidebar")
      .setDesc(
        "Keep right sidebar permanently collapsed. Keyboard shortcuts, hover, and CM transitions will not expand it.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin["rightDisabled"])
          .onChange((value) => {
            this.plugin.setDisabled("right", value);
          }),
      );
  }
}
