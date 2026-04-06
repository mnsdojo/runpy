# RunPy 🐍 (Tauri Edition)
> A RunJS-inspired Python playground — built with **Rust + Tauri** for a tiny, fast native app (~5MB vs Electron's ~150MB).

---

## Prerequisites

### 1. Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Tauri system dependencies

**macOS:**
```bash
xcode-select --install
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

**Windows:** Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### 3. Node.js (for Tauri CLI)
```bash
npm install
```

### 4. Python + Flask
```bash
pip3 install flask flask-cors
```

---

## Run in Development
```bash
npm run dev
```
This starts the Tauri dev window with hot-reload.

---

## Build a Native App
```bash
npm run build
```
Output goes to `src-tauri/target/release/bundle/`.

- **macOS** → `.dmg` + `.app`
- **Windows** → `.msi` + `.exe`
- **Linux** → `.AppImage` + `.deb`

---

## Project Structure
```
runpy-tauri/
├── package.json               # npm / Tauri CLI config
├── frontend/                  # Web UI (HTML + CSS + JS)
│   ├── index.html
│   ├── style.css
│   └── renderer.js            # Tauri API calls
└── src-tauri/
    ├── Cargo.toml             # Rust dependencies
    ├── build.rs
    ├── server.py              # Python execution backend
    ├── tauri.conf.json        # App config (name, window, bundle)
    ├── capabilities/
    │   └── default.json       # Permission grants
    └── src/
        ├── main.rs            # Entry point
        └── lib.rs             # Python process mgmt + Tauri commands
```

---

## How It Works
1. Tauri (Rust) launches the app window
2. On startup, `lib.rs` scans known Python paths and finds one with Flask
3. It spawns `server.py` as a child process on port **5822**
4. The frontend talks to `http://localhost:5822` for code execution
5. On app close, Rust kills the Python process cleanly

---

## Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Enter` | Run code |
| `Ctrl/Cmd + S` | Save file |
| `Ctrl/Cmd + O` | Open file |
| `Ctrl/Cmd + N` | New file |
| `Ctrl/Cmd + /` | Toggle comment |

---

## Why Tauri over Electron?
| | Tauri | Electron |
|---|---|---|
| Bundle size | ~5 MB | ~150 MB |
| Memory usage | ~50 MB | ~200 MB |
| Startup time | Fast | Slower |
| Runtime | OS WebView | Bundled Chromium |
| Language | Rust | Node.js |
# runny
# runny
# runny
# runpy
