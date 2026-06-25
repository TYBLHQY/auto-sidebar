# Auto Sidebar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/TYBLHQY/auto-sidebar)](https://github.com/TYBLHQY/auto-sidebar/releases)

Hover the edge of the window to reveal the sidebar — hides automatically when not in use. A compact mode for Obsidian inspired by Zen Browser.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/TYBLHQY/auto-sidebar/main/demo.gif">
  <img alt="Auto Sidebar demo" src="https://raw.githubusercontent.com/TYBLHQY/auto-sidebar/main/demo.gif">
</picture>

## Quick Start

1. Install from **Settings → Community plugins → Browse → "Auto Sidebar"**
2. Open the **Command Palette** (Ctrl/Cmd+P) and run **Toggle compact mode**
3. Move the cursor to the left edge of the window — the sidebar slides in

## Features

| Feature | Description |
|---|---|
| Hover-to-reveal | Sidebar hides offscreen; hover the left edge to show it |
| CSS transitions | Fast hide (0.15s), smooth reveal (0.25s ease-out) |
| State persistence | Remembers compact mode and sidebar width across restarts |
| Command toggle | Toggle compact mode on/off from the command palette |
| Window-aware | Concedes sidebar when tabbing away or switching monitors |

## Motivation

Obsidian's sidebar takes up screen space even when unused. Standard collapse narrows the editor but keeps the sidebar dock visible. Auto Sidebar removes the sidebar entirely from the layout — it overlays on demand — giving the note-taking area the full window while preserving one-click access to the file tree and navigation.

## How it works

The plugin positions the left sidebar absolutely and translates it offscreen via CSS `transform`. A mouse within 8 px of the left window edge triggers the overlay. Moving away hides it after a 150 ms delay. `mouseleave` and `blur` events catch context switches.

## Installation

### Community plugin directory

- **Settings → Community plugins → Browse → "Auto Sidebar"**

### BRAT (manual)

Add `TYBLHQY/auto-sidebar` to your [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin list.

## Compatibility

| Target | Status |
|---|---|
| Obsidian ≥ 0.15.0 | Supported |
| Mobile | Not available |

Desktop-only. Hover detection and window blur events depend on an Electron environment.

## Privacy

Auto Sidebar makes no network requests, collects no telemetry, and communicates with no external services. All data (compact mode state, sidebar width) is stored locally in the Obsidian plugin data directory.

## Contributing

Open an [issue](https://github.com/TYBLHQY/auto-sidebar/issues) or pull request.

## License

[MIT](LICENSE)
