#[cfg(not(debug_assertions))]
mod backend;

#[cfg(not(debug_assertions))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Packaged builds: start the backend. Dev builds already have Express on
      // :3001 via `beforeDevCommand`, so nothing is spawned here.
      #[cfg(not(debug_assertions))]
      start_backend(app.handle())?;

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        #[cfg(not(debug_assertions))]
        {
          use std::sync::Mutex;
          if let Some(mut child) = _app_handle
            .state::<Mutex<Option<std::process::Child>>>()
            .inner()
            .lock()
            .unwrap()
            .take()
          {
            let _ = child.kill();
          }
        }
      }
    });
}

/// Start the app backend. Preference: the Rust backend on :3021, with the
/// bundled Node stopgap on :3022 backfilling routes that aren't ported yet.
/// If the Rust server can't bind, fall back to Node directly on :3021.
/// The Node child (if any) is always managed so the exit handler can kill it.
#[cfg(not(debug_assertions))]
fn start_backend(app: &tauri::AppHandle) -> tauri::Result<()> {
  use std::sync::Mutex;

  let node_ok = std::process::Command::new("node")
    .arg("--version")
    .output()
    .map(|out| out.status.success())
    .unwrap_or(false);

  let child = match backend::spawn(backend::PORT, node_ok.then_some(backend::NODE_PROXY_PORT)) {
    Ok(()) => {
      eprintln!(
        "[backend] Rust backend on 127.0.0.1:{} (node backfill: {})",
        backend::PORT,
        if node_ok { "enabled" } else { "disabled" }
      );
      if node_ok {
        spawn_node_backend(app, backend::NODE_PROXY_PORT)
      } else {
        None
      }
    }
    Err(e) => {
      eprintln!("[backend] Rust backend failed to start ({e}) — falling back to Node on :3021");
      spawn_node_backend(app, backend::PORT)
    }
  };

  app.manage(Mutex::new(child));
  Ok(())
}

/// Spawn the bundled Express backend (`backend/server.js`) on the given port.
/// Returns None (logged) if Node is missing or the spawn fails.
#[cfg(not(debug_assertions))]
fn spawn_node_backend(app: &tauri::AppHandle, port: u16) -> Option<std::process::Child> {
  use std::process::Command;

  let node_ok = Command::new("node")
    .arg("--version")
    .output()
    .map(|out| out.status.success())
    .unwrap_or(false);
  if !node_ok {
    eprintln!("[backend] Node.js not found — stopgap backend unavailable");
    return None;
  }

  let resource_dir = app.path().resource_dir().ok()?;
  let server_js = resource_dir.join("backend").join("server.js");
  let server_js = if server_js.exists() {
    server_js
  } else {
    resource_dir.join("server.js")
  };
  if !server_js.exists() {
    eprintln!("[backend] bundled server.js not found in {:?}", resource_dir);
    return None;
  }

  let downloads_dir = app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| std::path::PathBuf::from("."))
    .join("downloads");
  std::fs::create_dir_all(&downloads_dir).ok();

  match Command::new("node")
    .arg(&server_js)
    .env("PORT", port.to_string())
    .env("SERVE_STATIC", "0")
    .env("DOWNLOADS_DIR", &downloads_dir)
    .env("YT_DLP_WARMUP", "0")
    .spawn()
  {
    Ok(child) => {
      eprintln!("[backend] Node stopgap on 127.0.0.1:{}", port);
      Some(child)
    }
    Err(e) => {
      eprintln!("[backend] failed to spawn Node: {e}");
      None
    }
  }
}
