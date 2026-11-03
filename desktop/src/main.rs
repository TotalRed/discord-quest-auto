// Desktop shell for Discord Quest Auto: starts the bundled Node agent, shows its
// panel in a native WebView window and keeps a tray icon. Closing the window
// hides it to the tray; "Выход" stops the agent and its runners.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Url, WindowEvent};

#[derive(Deserialize, Clone)]
struct Control {
    port: u16,
    token: String,
}

fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("QUEST_AUTO_DATA_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Local"));
        local.join("DiscordQuestAuto")
    } else {
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local").join("share"));
        data.join("discord-quest-auto")
    }
}

fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Program root: the folder with app/agent.mjs, next to the exe (packaged)
/// or in a parent folder (development build under desktop/target/...).
fn program_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .skip(1)
        .find(|dir| dir.join("app").join("agent.mjs").is_file())
        .map(Path::to_path_buf)
}

fn node_path(root: &Path) -> PathBuf {
    let bundled = root
        .join("runtime")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    if bundled.is_file() {
        bundled
    } else {
        PathBuf::from("node")
    }
}

fn start_agent(root: &Path) -> std::io::Result<()> {
    let mut command = Command::new(node_path(root));
    command
        .arg(root.join("app").join("agent.mjs"))
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    // A second agent exits by itself when one is already running.
    command.spawn().map(|_| ())
}

fn read_control() -> Option<Control> {
    let text = std::fs::read_to_string(data_dir().join("control.json")).ok()?;
    let control: Control = serde_json::from_str(&text).ok()?;
    (control.port >= 1024 && control.token.len() == 64).then_some(control)
}

/// Minimal HTTP/1.1 request to the local agent; returns the status code.
fn http(control: &Control, method: &str, path: &str) -> Option<u16> {
    let address = SocketAddr::from(([127, 0, 0, 1], control.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(800)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(15))).ok()?;
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        port = control.port,
        token = control.token
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut head = [0u8; 16];
    let read = stream.read(&mut head).ok()?;
    std::str::from_utf8(&head[..read])
        .ok()?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}

fn live_agent() -> Option<Control> {
    let control = read_control()?;
    (http(&control, "GET", "/api/status") == Some(200)).then_some(control)
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let text = serde_json::to_string(message).unwrap_or_default();
        let _ = window.eval(&format!(
            "document.body.innerHTML='<div class=\"box\" style=\"max-width:520px\"></div>';document.querySelector('.box').textContent={text};"
        ));
        let _ = window.show();
    }
}

/// Start (or find) the agent, then point the window at its panel.
fn connect(app: AppHandle) {
    thread::spawn(move || {
        let Some(root) = program_root() else {
            return show_error(&app, "Не найдена папка программы (app/agent.mjs). Распакуй архив целиком.");
        };
        let control = match live_agent() {
            Some(control) => control,
            None => {
                if let Err(error) = start_agent(&root) {
                    return show_error(&app, &format!("Не удалось запустить агент: {error}"));
                }
                let deadline = Instant::now() + Duration::from_secs(40);
                loop {
                    if let Some(control) = live_agent() {
                        break control;
                    }
                    if Instant::now() > deadline {
                        return show_error(&app, &format!(
                            "Агент не ответил за 40 секунд. Подробности в {}",
                            data_dir().join("latest.log").display()
                        ));
                    }
                    thread::sleep(Duration::from_millis(300));
                }
            }
        };
        let url = format!("http://127.0.0.1:{}/#{}", control.port, control.token);
        if let (Some(window), Ok(url)) = (app.get_webview_window("main"), Url::parse(&url)) {
            let _ = window.navigate(url);
        }
    });
}

fn quit(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if let Some(control) = read_control() {
        let _ = http(&control, "POST", "/api/quit");
    }
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .setup(|app| {
            let open = MenuItem::with_id(app, "show", "Открыть панель", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let exit = MenuItem::with_id(app, "quit", "Выход (остановить квесты)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &separator, &exit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Discord Quest Auto")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show(app),
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            if !std::env::args().any(|arg| arg == "--hidden") {
                show(app.handle());
            }
            connect(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Keep running in the tray; quests continue in the background.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start Discord Quest Auto");
}
