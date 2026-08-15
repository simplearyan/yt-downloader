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

      // Packaged builds: start the Node/Express backend (stopgap — the Rust
      // backend replaces this). Dev builds already have Express on :3001 via
      // `beforeDevCommand`, so nothing is spawned here.
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
          if let Some(child) = _app_handle
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

/// Spawn the bundled Express backend (`backend/server.js`) on 127.0.0.1:3021.
/// If Node.js isn't installed, the frontend shows a clear message once its
/// retries are exhausted — this is never fatal for the app itself.
#[cfg(not(debug_assertions))]
fn start_backend(app: &tauri::AppHandle) -> tauri::Result<()> {
  use std::process::{Child, Command};
  use std::sync::Mutex;

  // Node on PATH?
  let node_ok = Command::new("node")
    .arg("--version")
    .output()
    .map(|out| out.status.success())
    .unwrap_or(false);
  if !node_ok {
    eprintln!("[backend] Node.js not found — packaged backend will not start");
    return Ok(());
  }

  // Locate the bundled server.js (resource dir). Prefer the preserved
  // structure, fall back to a flattened copy.
  let resource_dir = app.path().resource_dir()?;
  let server_js = resource_dir.join("backend").join("server.js");
  let server_js = if server_js.exists() {
    server_js
  } else {
    resource_dir.join("server.js")
  };
  if !server_js.exists() {
    eprintln!("[backend] bundled server.js not found in {:?}", resource_dir);
    return Ok(());
  }

  // Downloads must go to a writable location (install dir may be read-only).
  let downloads_dir = app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| std::path::PathBuf::from("."))
    .join("downloads");
  std::fs::create_dir_all(&downloads_dir).ok();

  let child = Command::new("node")
    .arg(&server_js)
    .env("PORT", "3021")
    .env("SERVE_STATIC", "0")
    .env("DOWNLOADS_DIR", &downloads_dir)
    .env("YT_DLP_WARMUP", "0")
    .spawn()
    .map_err(tauri::Error::Io)?;

  app.manage(Mutex::new(Some(child)));
  eprintln!("[backend] started on http://127.0.0.1:3021");
  Ok(())
}
