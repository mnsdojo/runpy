use tauri::Emitter;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const BACKEND_PORT: u16 = 5822;
const BACKEND_URL: &str = "http://localhost:5822";

// Global Python process handle
struct PythonProcess(Mutex<Option<Child>>);

// ── Find Python with Flask ────────────────────────────────────────────────────
fn find_python() -> Option<String> {
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec!["python", "python3"]
    } else if cfg!(target_os = "macos") {
        vec![
            "/usr/bin/python3",
            "/usr/local/bin/python3",
            "/opt/homebrew/bin/python3",
            "/opt/homebrew/bin/python3.13",
            "/opt/homebrew/bin/python3.12",
            "/opt/homebrew/bin/python3.11",
            "/usr/local/bin/python3.13",
            "/usr/local/bin/python3.12",
            "/usr/local/bin/python3.11",
            "python3",
            "python",
        ]
    } else {
        vec![
            "/usr/bin/python3",
            "/usr/local/bin/python3",
            "python3",
            "python",
        ]
    };

    for cmd in candidates {
        let result = Command::new(cmd)
            .args(["-c", "import flask; print('ok')"])
            .output();

        if let Ok(out) = result {
            if out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "ok" {
                println!("[RunPy] Found Python with Flask: {}", cmd);
                return Some(cmd.to_string());
            }
        }
    }
    None
}

// ── Start Python backend ──────────────────────────────────────────────────────
fn start_backend(python_cmd: &str, server_path: &str) -> Option<Child> {
    println!("[RunPy] Starting backend: {} {}", python_cmd, server_path);

    let mut cmd = Command::new(python_cmd);
    cmd.arg(server_path);

    // Ensure PATH includes common Python locations
    #[cfg(not(target_os = "windows"))]
    {
        let existing_path = std::env::var("PATH").unwrap_or_default();
        cmd.env(
            "PATH",
            format!("/usr/bin:/usr/local/bin:/opt/homebrew/bin:{}", existing_path),
        );
    }

    match cmd.spawn() {
        Ok(child) => {
            println!("[RunPy] Backend process spawned (pid: {})", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[RunPy] Failed to spawn backend: {}", e);
            None
        }
    }
}

// ── Wait for backend to be ready ──────────────────────────────────────────────
fn wait_for_backend(timeout_secs: u64) -> bool {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        if let Ok(resp) = reqwest::blocking::get(format!("{}/health", BACKEND_URL)) {
            if resp.status().is_success() {
                println!("[RunPy] Backend is ready!");
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_backend_url() -> String {
    BACKEND_URL.to_string()
}

#[tauri::command]
fn get_backend_port() -> u16 {
    BACKEND_PORT
}

// ── App setup & run ───────────────────────────────────────────────────────────
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PythonProcess(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let resource_path = app
                .path()
                .resource_dir()
                .expect("failed to get resource dir");
            let server_path = resource_path
                .join("server.py")
                .to_string_lossy()
                .to_string();

            println!("[RunPy] server.py path: {}", server_path);

            // Spawn backend startup in background thread
            std::thread::spawn(move || {
                // Check if already running
                if wait_for_backend(2) {
                    println!("[RunPy] Backend already running, skipping spawn.");
                    return;
                }

                match find_python() {
                    None => {
                        eprintln!("[RunPy] No Python with Flask found!");
                        // Emit event to frontend
                        app_handle.emit("backend-error",
                            "Python 3 with Flask not found.\n\nRun in Terminal:\n  pip3 install flask flask-cors\n\nThen restart RunPy."
                        ).ok();
                    }
                    Some(python_cmd) => {
                        let process_state: State<PythonProcess> =
                            app_handle.state::<PythonProcess>();

                        if let Some(child) = start_backend(&python_cmd, &server_path) {
                            *process_state.0.lock().unwrap() = Some(child);
                        }

                        if wait_for_backend(15) {
                            app_handle.emit("backend-ready", BACKEND_URL).ok();
                        } else {
                            app_handle.emit("backend-error",
                                "Backend started but not responding.\n\nTest manually:\n  python3 server.py"
                            ).ok();
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill python process on window close
                if let Some(state) = window.try_state::<PythonProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            child.kill().ok();
                            println!("[RunPy] Python backend killed.");
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_backend_url, get_backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
