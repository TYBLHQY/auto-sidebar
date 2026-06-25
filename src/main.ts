import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

interface Store {
  leftCompact: boolean;
  leftWidth: number;
  leftDisabled: boolean;
}

const HOVER_ZONE_PX = 8;
const HIDE_DELAY_MS = 150;      // sidebar-keep-hover.duration (Zen default 150)
const DOC_LEAVE_DELAY_MS = 1000; // toolbar-hide-after-hover.duration (Zen default 1000)

export default class AutoSidebarPlugin extends Plugin {
  private leftCompact = false;
  private leftWidth = 270;
  /** Disabled — sidebar stays permanently collapsed/unexpandable */
  private leftDisabled = false;

  private listenerActive = false;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Obsidian's inline `width` before we overwrite it for overlay. */
  private obsidianWidth = "";

  /* ================================================================
     LIFECYCLE
     ================================================================ */

  async onload(): Promise<void> {
    const data = await this.loadData();
    if (data) {
      this.leftCompact = (data as Store).leftCompact ?? false;
      this.leftWidth = (data as Store).leftWidth ?? 270;
      this.leftDisabled = (data as Store).leftDisabled ?? false;
    }

    this.addSettingTab(new AutoSidebarSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-left-compact",
      name: "Toggle compact mode",
      callback: () => this.toggle(),
    });

    this.app.workspace.onLayoutReady(() => {
      // Restore CM at startup using the SAVED width — the DOM may not
      // have its final layout yet, so measuring it would be unreliable.
      if (!this.leftDisabled && this.leftCompact) {
        const split = this.splitAPI();
        if (split) {
          split.expand();
          requestAnimationFrame(() => {
            const el = this.splitEl();
            if (!el) return;
            this.obsidianWidth = el.style.width || "";
            el.style.setProperty("width", this.leftWidth + "px", "important");
            el.classList.add("auto-sidebar-compact");
            this.leftCompact = true;
            this.syncListener();
            this.persist();
          });
        }
      }

      // If disabled, ensure sidebar is collapsed via Obsidian API
      if (this.leftDisabled) {
        const split = this.splitAPI();
        if (split && !split.collapsed) split.collapse();
      }
    });
  }

  onunload(): void {
    this.cleanupSide();
    this.teardownListeners();
  }

  /* ================================================================
     TOGGLE
     ================================================================ */

  private toggle(): void {
    if (this.leftDisabled) return;
    if (this.leftCompact) {
      this.uncompact();
    } else {
      this.enterCompact();
    }
  }

  /* ================================================================
     ENTER COMPACT MODE  (NCM → CM)
     ================================================================ */

  private enterCompact(): void {
    if (this.leftDisabled) return;
    const split = this.splitAPI();
    if (!split) return;
    split.expand();

    requestAnimationFrame(() => {
      const el = this.splitEl();
      if (!el) return;

      const w = el.getBoundingClientRect().width;

      // Sidebar has no real DOM width (layout not ready, or collapsed
      // via Obsidian API).  Don't enter CM — doing so puts the sidebar
      // in a broken state where the toggle can't recover.
      if (w <= 10) {
        this.leftCompact = false;
        this.persist();
        return;
      }

      this.leftWidth = w;

      // Save Obsidian's inline width before we overwrite it
      this.obsidianWidth = el.style.width || "";

      el.style.setProperty("width", w + "px", "important");
      el.classList.add("auto-sidebar-compact");
      this.leftCompact = true;
      this.syncListener();
      this.persist();
    });
  }

  /* ================================================================
     EXIT COMPACT MODE  (CM → NCM)
     ================================================================ */

  private uncompact(): void {
    const el = this.splitEl();
    if (!el) return;

    const split = this.splitAPI();
    const w = this.leftWidth;

    // Remove CM positioning FIRST so the sidebar is back in flex flow,
    // THEN expand via Obsidian API.  Always expand — if CM left the
    // sidebar in an intermediate state, collapsed may be false while
    // the flex item still has zero width.
    el.classList.remove(
      "auto-sidebar-compact",
      "auto-sidebar-visible",
    );
    split?.expand();

    // Restore width
    el.style.removeProperty("width");
    if (this.obsidianWidth) {
      el.style.width = this.obsidianWidth;
    } else {
      el.style.width = w + "px";
    }

    this.leftCompact = false;
    this.persist();
    this.syncListener();
  }

  /* ================================================================
     OVERLAY SHOW / HIDE  (CM only, hover-triggered, no animation)
     ================================================================ */

  private revealOverlay(): void {
    const el = this.splitEl();
    if (!el || el.classList.contains("auto-sidebar-visible")) return;

    const split = this.splitAPI();
    if (split?.collapsed) split.expand();

    el.style.setProperty("width", this.leftWidth + "px", "important");
    el.classList.add("auto-sidebar-visible");
  }

  private concealOverlay(): void {
    const el = this.splitEl();
    if (!el || !el.classList.contains("auto-sidebar-visible")) return;

    el.classList.remove("auto-sidebar-visible");
  }

  /* ================================================================
     HOVER DETECTION
     ================================================================ */

  /** Mouse left Obsidian's window entirely — start delayed hide. */
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

  /** Mouse re-entered the window — cancel pending hide. */
  private onDocumentEnter = (): void => {
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  };

  /** Window lost focus (Alt+Tab, Win+Tab, Cmd+`) — trigger delayed hide. */
  private onWindowBlur = (): void => {
    this.onDocumentLeave();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.leftCompact) this.edgeCheck(e.clientX, e.clientY);
  };

  private edgeCheck(x: number, y: number): void {
    if (this.leftDisabled) return;
    const el = this.splitEl();
    if (!el) return;

    const showing = el.classList.contains("auto-sidebar-visible");
    const nearEdge = x <= HOVER_ZONE_PX;

    if (nearEdge && !showing) {
      this.clearTimer();
      this.revealOverlay();
      return;
    }

    if (!showing) return;

    if (this.pointerIn(el, x, y)) {
      this.clearTimer();
    } else if (!nearEdge) {
      this.startTimer();
    }
  }

  private pointerIn(el: HTMLElement, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private startTimer(): void {
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
      document.addEventListener("mousemove", this.onMouseMove);
      document.documentElement.addEventListener("mouseleave", this.onDocumentLeave);
      document.documentElement.addEventListener("mouseenter", this.onDocumentEnter);
      window.addEventListener("blur", this.onWindowBlur);
      this.listenerActive = true;
    } else if (!this.leftCompact && this.listenerActive) {
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
      leftWidth: this.leftWidth,
      leftDisabled: this.leftDisabled,
    } as Store);
  }

  /* ================================================================
     HELPERS
     ================================================================ */

  private splitAPI(): any {
    return (this.app.workspace as any).leftSplit;
  }

  private splitEl(): HTMLElement | null {
    return (this.splitAPI() as any)?.containerEl ?? null;
  }

  /** Enable/disable the sidebar.  When enabling disable, the sidebar is
   *  exited from CM (if active) and collapsed via the Obsidian API.  When
   *  disabling disable, the sidebar is expanded again. */
  public setDisabled(value: boolean): void {
    this.leftDisabled = value;

    if (value) {
      // Exit CM immediately if active
      if (this.leftCompact) {
        this.cleanupSide();
        this.leftCompact = false;
      }

      // Collapse via Obsidian API — keeps sidebar closed in NCM
      const split = this.splitAPI();
      if (split && !split.collapsed) {
        split.collapse();
      }

      this.syncListener();
    } else {
      // Re-enabling sidebar — expand so it becomes visible again
      const split = this.splitAPI();
      if (split && split.collapsed) {
        split.expand();
      }
    }

    this.persist();
  }

  private cleanupSide(): void {
    const el = this.splitEl();
    if (!el) return;

    // Ensure Obsidian sees the sidebar as expanded before we remove our
    // absolute positioning — otherwise the flex item comes back at zero
    // width.
    const split = this.splitAPI();
    if (split?.collapsed) split.expand();

    el.classList.remove(
      "auto-sidebar-compact",
      "auto-sidebar-visible",
    );
    el.style.removeProperty("width");
    if (this.obsidianWidth) {
      el.style.width = this.obsidianWidth;
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
      .setName("Disable sidebar")
      .setDesc(
        "Keep left sidebar permanently collapsed. Keyboard shortcuts, hover, and CM transitions will not expand it.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin["leftDisabled"])
          .onChange((value) => {
            this.plugin.setDisabled(value);
          }),
      );
  }
}
