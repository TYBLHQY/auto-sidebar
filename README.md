# Auto Sidebar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Auto Sidebar** brings a Zen Browser-style compact mode to Obsidian's sidebars. The left sidebar stays hidden until you move your mouse to the edge of the window — then it smoothly slides into view.

![Demo](https://raw.githubusercontent.com/TYBLHQY/auto-sidebar/main/demo.gif)

## Features

- 🖱️ **Hover-to-reveal** — Sidebar hides offscreen; hover the left edge to show it
- ⚡ **Smooth animations** — CSS-powered transitions (fast hide, graceful reveal)
- 🧠 **Smart persistence** — Remembers compact mode state and sidebar width across restarts
- 🔁 **Toggle command** — Use the command palette to toggle compact mode on/off
- 🪶 **Lightweight** — Zero external network requests, no dependencies beyond Obsidian's API

## How it works

When compact mode is active, the left sidebar is positioned absolutely and translated offscreen via CSS `transform`. Moving the cursor within 8 px of the left edge of the window reveals it as an overlay. Moving the mouse away hides it after a 150 ms delay.

The plugin also watches for `mouseleave` on the document and `blur` on the window to conceal the sidebar when you tab away or move to another monitor.

## Installation

### From the Community Plugin Directory (pending review)

1. Open **Settings** → **Community plugins**
2. Disable **Safe mode**
3. Click **Browse** and search for "Auto Sidebar"
4. Install and enable the plugin

### Manual / BRAT

> **Note:** This plugin is listed in the Obsidian Community Plugin directory. For manual installation via [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `TYBLHQY/auto-sidebar` to your BRAT plugin list.

## Usage

1. **Enable** the plugin in **Settings** → **Community plugins**
2. Open the **Command Palette** (Ctrl/Cmd+P)
3. Run **"Toggle compact mode"**
4. Move your cursor to the left edge of the window to reveal the sidebar
5. Run the command again to exit compact mode

## Compatibility

| Obsidian Version | Status |
|-----------------|--------|
| ≥ 0.15.0        | ✅ Supported |
| Desktop only     | ⚠️ Not available on mobile |

This plugin requires a desktop environment (electron) for the hover detection and window blur events to work correctly.

## Privacy

Auto Sidebar makes **no network requests**, collects **no telemetry**, and communicates with **no external services**. All data (compact mode state, sidebar width) is stored locally in your Obsidian plugin data directory.

## License

Licensed under the [MIT License](LICENSE).

---

*Not an official Obsidian plugin. Built for the Obsidian community.*
