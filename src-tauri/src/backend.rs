//! Rust backend for the packaged Tauri app — same API contract as `server.js`.
//!
//! Option B rollout: the Rust server listens on :3021 and implements endpoints
//! natively as they are ported (Phase 1: `/api/info/quick`). Any route that is
//! not yet implemented is **proxied** to the bundled Node stopgap (on a side
//! port), so the app keeps working while the port progresses. If the Rust
//! server cannot bind at all, the caller falls back to Node directly on :3021.

use axum::{
  body::{to_bytes, Body},
  extract::{OriginalUri, Query, Request, State},
  http::{header, HeaderMap, Method, StatusCode},
  middleware::{self, Next},
  response::Response,
  routing::get,
  Router,
};
use futures_util::future::{BoxFuture, Shared};
use futures_util::{FutureExt, TryStreamExt};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

/// Port the Rust backend listens on (matches the frontend `API_BASE`).
pub const PORT: u16 = 3021;
/// Port the bundled Node stopgap runs on to backfill not-yet-ported routes.
pub const NODE_PROXY_PORT: u16 = 3022;

const OEMBED_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const OEMBED_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Default)]
pub struct BackendState {
  oembed_cache: Arc<Mutex<HashMap<String, (SystemTime, Value)>>>,
  format_cache: Arc<Mutex<HashMap<String, (SystemTime, Value)>>>,
  /// In-flight dedupe for /api/info - concurrent identical URLs share one
  /// yt-dlp run via a cloneable shared future (server.js inflightInfo parity).
  inflight_info: Arc<Mutex<HashMap<String, Shared<BoxFuture<'static, Result<Value, String>>>>>>,
  node_proxy_url: Arc<String>,
  node_available: Arc<AtomicBool>,
}

// ── URL helpers (ported from server.js) ────────────────────────────────────
static YT_RE: OnceLock<Regex> = OnceLock::new();
fn yt_re() -> &'static Regex {
  YT_RE.get_or_init(|| {
    Regex::new(
      r"^https?://(www\.)?youtube\.com/(watch\?v=[\w-]{11}|embed/[\w-]{11}|shorts/[\w-]{11}|playlist\?list=)|^https?://youtu\.be/[\w-]{11}",
    )
    .expect("yt regex")
  })
}

static YT_ID_RE: OnceLock<Regex> = OnceLock::new();
fn yt_id_re() -> &'static Regex {
  YT_ID_RE
    .get_or_init(|| {
      Regex::new(r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([\w-]{11})").expect("id regex")
    })
}

/// Strip tracking parameters (si, feature, pp, utm_*) — server.js parity.
fn sanitize_url(url: &str) -> String {
  let (base, query) = match url.split_once('?') {
    Some((b, q)) => (b, Some(q)),
    None => (url, None),
  };
  let Some(query) = query else { return url.to_string() };
  let keep: Vec<&str> = query
    .split('&')
    .filter(|pair| {
      let key = pair.split('=').next().unwrap_or("");
      !matches!(
        key,
        "si" | "feature" | "pp" | "utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content"
      )
    })
    .collect();
  if keep.is_empty() {
    base.to_string()
  } else {
    format!("{}?{}", base, keep.join("&"))
  }
}

fn is_valid_youtube_url(url: &str) -> bool {
  yt_re().is_match(url.trim())
}

fn extract_video_id(url: &str) -> Option<String> {
  yt_id_re().captures(url).map(|c| c[1].to_string())
}

// ── oEmbed cache (10-min TTL, same as server.js) ───────────────────────────
fn cache_get(state: &BackendState, url: &str) -> Option<Value> {
  let mut cache = state.oembed_cache.lock().unwrap();
  if let Some((at, value)) = cache.get(url) {
    if at.elapsed().ok() < Some(OEMBED_CACHE_TTL) {
      return Some(value.clone());
    }
    cache.remove(url);
  }
  None
}

fn cache_set(state: &BackendState, url: &str, value: Value) {
  state
    .oembed_cache
    .lock()
    .unwrap()
    .insert(url.to_string(), (SystemTime::now(), value));
}
// ---- Format cache (30-min TTL, LRU at 50) + helpers - server.js parity ----
const FORMAT_CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const FORMAT_CACHE_MAX: usize = 50;

fn format_cache_get(state: &BackendState, url: &str) -> Option<Value> {
  let mut cache = state.format_cache.lock().unwrap();
  if let Some((at, value)) = cache.get(url) {
    if at.elapsed().ok() < Some(FORMAT_CACHE_TTL) {
      let v = value.clone();
      cache.remove(url); // touch -> move to end (LRU recency)
      cache.insert(url.to_string(), (SystemTime::now(), v.clone()));
      return Some(v);
    }
    cache.remove(url);
  }
  None
}

fn format_cache_set(state: &BackendState, url: &str, value: Value) {
  let mut cache = state.format_cache.lock().unwrap();
  cache.remove(url);
  cache.insert(url.to_string(), (SystemTime::now(), value));
  while cache.len() > FORMAT_CACHE_MAX {
    match cache.keys().next().cloned() {
      Some(oldest) => {
        cache.remove(&oldest);
      }
      None => break,
    }
  }
}

fn jstr(v: &Value, key: &str) -> String {
  v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn jint(v: &Value, key: &str) -> i64 {
  v.get(key)
    .and_then(|x| x.as_i64())
    .or_else(|| v.get(key).and_then(|x| x.as_f64()).map(|f| f as i64))
    .unwrap_or(0)
}

/// Map one yt-dlp format entry to the app's format shape (server.js parity).
fn map_format(f: &Value) -> Value {
  let vcodec = jstr(f, "vcodec");
  let acodec = jstr(f, "acodec");
  let vc = vcodec.to_lowercase();
  let height = f.get("height").and_then(|x| x.as_f64()).unwrap_or(0.0) as i64;
  let abr = f.get("abr").and_then(|x| x.as_f64()).unwrap_or(0.0);

  let codec_category = if vc.starts_with("avc") || vc.starts_with("h.264") || vc.starts_with("x264") {
    "H.264".to_string()
  } else if vc.starts_with("vp9") {
    "VP9".to_string()
  } else if vc.starts_with("av01") {
    "AV1".to_string()
  } else if vc.starts_with("hev") || vc.starts_with("h.265") || vc.starts_with("x265") {
    "H.265".to_string()
  } else if vc.starts_with("vp8") {
    "VP8".to_string()
  } else if vcodec != "none" {
    vcodec.split('.').next().unwrap_or("").to_uppercase()
  } else {
    String::new()
  };

  let quality = if height > 0 {
    format!("{}p", height)
  } else if abr > 0.0 {
    format!("{}kbps", abr.round() as i64)
  } else {
    "audio only".to_string()
  };

  let filesize = f
    .get("filesize")
    .and_then(|x| x.as_u64())
    .filter(|&v| v > 0)
    .or_else(|| f.get("filesize_approx").and_then(|x| x.as_u64()).filter(|&v| v > 0))
    .or_else(|| f.get("filesize").and_then(|x| x.as_f64()).map(|x| x as u64).filter(|&v| v > 0))
    .or_else(|| {
      f.get("filesize_approx")
        .and_then(|x| x.as_f64())
        .map(|x| x as u64)
        .filter(|&v| v > 0)
    })
    .unwrap_or(0);

  json!({
    "formatId": jstr(f, "format_id"),
    "ext": jstr(f, "ext"),
    "quality": quality,
    "vcodec": vcodec,
    "acodec": acodec,
    "codecCategory": codec_category,
    "filesize": filesize,
    "fps": jint(f, "fps"),
    "hasVideo": vcodec != "none",
    "hasAudio": acodec != "none",
  })
}

/// Full yt-dlp `--dump-json` fetch, ported 1:1 from server.js /api/info
/// (same args, format filtering, best-options, error message).
async fn fetch_full_info(_state: BackendState, url: String) -> Result<Value, String> {
  let output = tokio::time::timeout(
    Duration::from_secs(30),
    tokio::process::Command::new("yt-dlp")
      .args(["--no-playlist", "--skip-download", "--dump-json", "--no-warnings", &url])
      .output(),
  )
  .await
  .map_err(|_| "yt-dlp timed out after 30000ms".to_string())?
  .map_err(|e| format!("spawn yt-dlp: {e}"))?;

  if !output.status.success() {
    return Err(format!("yt-dlp exited with code {:?}", output.status.code()));
  }
  if output.stdout.len() > 10 * 1024 * 1024 {
    return Err("yt-dlp output exceeded maxBuffer".to_string());
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let last_line = stdout.trim().lines().last().ok_or("yt-dlp produced no output")?;
  let data: Value = serde_json::from_str(last_line).map_err(|e| format!("parse dump-json: {e}"))?;

  let formats: Vec<Value> = data
    .get("formats")
    .and_then(|x| x.as_array())
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter(|f| {
      let vc = jstr(f, "vcodec");
      let ac = jstr(f, "acodec");
      vc != "none" || ac != "none"
    })
    .filter(|f| {
      if jstr(f, "format_id").starts_with("sb") {
        return false;
      }
      let h = f.get("height").and_then(|x| x.as_f64()).unwrap_or(0.0) as i64;
      if h > 0 && h < 200 {
        return false;
      }
      true
    })
    .map(|f| map_format(&f))
    .filter(|f| {
      f.get("hasVideo").and_then(|x| x.as_bool()).unwrap_or(false)
        || f.get("hasAudio").and_then(|x| x.as_bool()).unwrap_or(false)
    })
    .collect();

  let has_video = |f: &Value| f.get("hasVideo").and_then(|x| x.as_bool()).unwrap_or(false);
  let has_audio = |f: &Value| f.get("hasAudio").and_then(|x| x.as_bool()).unwrap_or(false);
  let video_formats: Vec<&Value> = formats.iter().filter(|f| has_video(f) && !has_audio(f)).collect();
  let audio_formats: Vec<&Value> = formats.iter().filter(|f| has_audio(f) && !has_video(f)).collect();

  let best_video_size = video_formats.iter().map(|f| jint(f, "filesize")).max().unwrap_or(0);
  let best_h264_size = video_formats
    .iter()
    .filter(|f| jstr(f, "codecCategory") == "H.264")
    .map(|f| jint(f, "filesize"))
    .max()
    .unwrap_or(0);
  let best_audio_size = audio_formats.iter().map(|f| jint(f, "filesize")).max().unwrap_or(0);

  Ok(json!({
    "id": jstr(&data, "id"),
    "title": jstr(&data, "title"),
    "thumbnail": jstr(&data, "thumbnail"),
    "duration": jint(&data, "duration"),
    "uploader": jstr(&data, "uploader"),
    "uploaderUrl": jstr(&data, "uploader_url"),
    "viewCount": jint(&data, "view_count"),
    "formats": formats,
    "bestOptions": json!([
      {
        "label": "\u{1F3AC} Best Video + Audio (MP4)",
        "formatId": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "ext": "mp4",
        "quality": "Best",
        "codecCategory": "",
        "filesize": best_video_size + best_audio_size,
        "hasVideo": true,
        "hasAudio": true,
        "isBest": true,
      },
      {
        "label": "\u{1F3B5} H.264 Video + Audio (MP4)",
        "formatId": "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "ext": "mp4",
        "quality": "H.264",
        "codecCategory": "H.264",
        "filesize": best_h264_size + best_audio_size,
        "hasVideo": true,
        "hasAudio": true,
        "isBest": true,
      },
      {
        "label": "\u{1F3B5} Best Audio Only (MP3)",
        "formatId": "bestaudio/best",
        "ext": "mp3",
        "quality": "Best",
        "codecCategory": "",
        "filesize": best_audio_size,
        "hasVideo": false,
        "hasAudio": true,
        "isBest": true,
      },
    ]),
  }))
}

/// GET /api/info handler - cache -> in-flight dedupe -> shared yt-dlp run.
async fn full_info(State(state): State<BackendState>, Query(params): Query<HashMap<String, String>>) -> Response {
  let url = sanitize_url(&params.get("url").cloned().unwrap_or_default());
  if url.trim().is_empty() || !is_valid_youtube_url(&url) {
    return json_response(
      StatusCode::BAD_REQUEST,
      json!({ "error": "Invalid YouTube URL. Please enter a valid YouTube URL." }),
    );
  }

  if let Some(cached) = format_cache_get(&state, &url) {
    return json_response(StatusCode::OK, cached);
  }

  let shared = {
    let mut map = state.inflight_info.lock().unwrap();
    if let Some(existing) = map.get(&url) {
      existing.clone()
    } else {
      let fut: BoxFuture<'static, Result<Value, String>> =
        Box::pin(fetch_full_info(state.clone(), url.clone()));
      let shared = fut.shared();
      map.insert(url.clone(), shared.clone());
      shared
    }
  };

  let result = match shared.await {
    Ok(v) => {
      format_cache_set(&state, &url, v.clone());
      json_response(StatusCode::OK, v)
    }
    Err(_) => json_response(
      StatusCode::INTERNAL_SERVER_ERROR,
      json!({ "error": "Failed to fetch video info. The video might be private, age-restricted, or unavailable." }),
    ),
  };
  state.inflight_info.lock().unwrap().remove(&url);
  result
}


// ── Helpers / handlers ─────────────────────────────────────────────────────
fn json_response(status: StatusCode, value: Value) -> Response {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, "application/json")
    .body(Body::from(value.to_string()))
    .unwrap()
}

/// GET /api/info/quick — oEmbed with a yt-dlp `--print` fallback (server.js parity).
async fn quick_info(
  State(state): State<BackendState>,
  Query(params): Query<HashMap<String, String>>,
) -> Response {
  let url = sanitize_url(&params.get("url").cloned().unwrap_or_default());
  if url.trim().is_empty() || !is_valid_youtube_url(&url) {
    return json_response(
      StatusCode::BAD_REQUEST,
      json!({ "error": "Invalid YouTube URL. Please enter a valid YouTube URL." }),
    );
  }

  if let Some(cached) = cache_get(&state, &url) {
    return json_response(StatusCode::OK, cached);
  }

  let video_id = extract_video_id(&url);
  let result = match fetch_oembed(&url).await {
    Some(value) => value,
    None => ytdlp_print_fallback(&url, video_id).await,
  };
  if result.get("error").is_some() {
    return json_response(
      StatusCode::INTERNAL_SERVER_ERROR,
      json!({ "error": "Failed to fetch video info. The video might be private, age-restricted, or unavailable." }),
    );
  }
  cache_set(&state, &url, result.clone());
  json_response(StatusCode::OK, result)
}

async fn fetch_oembed(url: &str) -> Option<Value> {
  let oembed_url = reqwest::Url::parse_with_params(
    "https://www.youtube.com/oembed",
    &[("url", url), ("format", "json")],
  )
  .ok()?;
  let client = reqwest::Client::builder().timeout(OEMBED_TIMEOUT).build().ok()?;
  let resp = client.get(oembed_url).send().await.ok()?;
  if !resp.status().is_success() {
    return None;
  }
  let data: Value = resp.json().await.ok()?;
  let video_id = extract_video_id(url);
  let thumb = data["thumbnail_url"]
    .as_str()
    .map(String::from)
    .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id.clone().unwrap_or_default()));
  Some(json!({
    "id": video_id.unwrap_or_default(),
    "title": data["title"].as_str().unwrap_or("Unknown"),
    "thumbnail": thumb,
    "duration": 0,
    "uploader": data["author_name"].as_str().unwrap_or(""),
    "uploaderUrl": data["author_url"].as_str().unwrap_or(""),
    "viewCount": 0,
  }))
}

/// server.js quick-info fallback: `yt-dlp --print` with the same fields.
async fn ytdlp_print_fallback(url: &str, video_id: Option<String>) -> Value {
  let output = tokio::process::Command::new("yt-dlp")
    .args([
      "--no-playlist",
      "--skip-download",
      "--no-warnings",
      "--print", "title: %(title)s",
      "--print", "id: %(id)s",
      "--print", "duration: %(duration)s",
      "--print", "thumbnail: %(thumbnail)s",
      "--print", "view_count: %(view_count)s",
      "--print", "uploader: %(uploader)s",
      "--print", "uploader_url: %(uploader_url)s",
      url,
    ])
    .output()
    .await;
  let stdout = match output {
    Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
    _ => return json!({ "error": "yt-dlp fallback failed" }),
  };
  let mut info: HashMap<String, String> = HashMap::new();
  for line in stdout.lines() {
    if let Some((k, v)) = line.split_once(": ") {
      info.insert(k.trim().to_string(), v.trim().to_string());
    }
  }
  json!({
    "id": info.get("id").cloned().unwrap_or_else(|| video_id.unwrap_or_default()),
    "title": info.get("title").cloned().unwrap_or_else(|| "Unknown".into()),
    "thumbnail": info.get("thumbnail").cloned().unwrap_or_default(),
    "duration": info.get("duration").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
    "uploader": info.get("uploader").cloned().unwrap_or_default(),
    "uploaderUrl": info.get("uploader_url").cloned().unwrap_or_default(),
    "viewCount": info.get("view_count").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
  })
}

/// Proxy any route the Rust backend hasn't implemented yet to the bundled Node
/// stopgap — preserves status, content-type, content-disposition, and streams
/// the body (SSE + file downloads keep working). Node's own CORS headers are
/// intentionally dropped; the middleware adds a single consistent set.
async fn proxy(
  State(state): State<BackendState>,
  OriginalUri(uri): OriginalUri,
  method: Method,
  headers: HeaderMap,
  body: Body,
) -> Response {
  if !state.node_available.load(Ordering::Relaxed) {
    return json_response(StatusCode::SERVICE_UNAVAILABLE, json!({ "error": "Backend unavailable." }));
  }
  let path = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
  let target = format!("{}{}", state.node_proxy_url, path);
  let body_bytes = to_bytes(body, usize::MAX).await.unwrap_or_default();

  let mut rb = reqwest::Client::new().request(method, &target);
  if let Some(ct) = headers.get(header::CONTENT_TYPE) {
    if let Ok(v) = ct.to_str() {
      rb = rb.header(header::CONTENT_TYPE, v);
    }
  }
  match rb.body(body_bytes).send().await {
    Ok(resp) => {
      let status = resp.status();
      let mut builder = Response::builder().status(status);
      for name in [header::CONTENT_TYPE, header::CONTENT_DISPOSITION] {
        if let Some(v) = resp.headers().get(&name) {
          if let Ok(v) = v.to_str() {
            builder = builder.header(name, v);
          }
        }
      }
      let stream = resp.bytes_stream().map_err(|e| e);
      builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| json_response(StatusCode::BAD_GATEWAY, json!({ "error": "Proxy error" })))
    }
    Err(_) => json_response(StatusCode::BAD_GATEWAY, json!({ "error": "Backend proxy failed." })),
  }
}

/// CORS for the Tauri webview origin (tauri:// / http://tauri.localhost).
async fn cors(req: Request, next: Next) -> Response {
  let mut res = if req.method() == Method::OPTIONS {
    let mut r = Response::new(Body::empty());
    *r.status_mut() = StatusCode::NO_CONTENT;
    r
  } else {
    next.run(req).await
  };
  let h = res.headers_mut();
  h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
  h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, "GET,POST,OPTIONS".parse().unwrap());
  h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type".parse().unwrap());
  res
}

pub fn router(state: BackendState) -> Router {
  Router::new()
    .route("/api/info", get(full_info))
    .route("/api/info/quick", get(quick_info))
    .fallback(proxy)
    .layer(middleware::from_fn(cors))
    .with_state(state)
}

/// Bind the Rust backend on 127.0.0.1:port and serve in a background thread.
/// `node_proxy_port` enables the Node backfill for not-yet-ported routes.
/// Returns Err only if the port can't be bound (caller then falls back to Node).
pub fn spawn(port: u16, node_proxy_port: Option<u16>) -> Result<(), String> {
  let state = BackendState {
    node_proxy_url: Arc::new(format!("http://127.0.0.1:{}", node_proxy_port.unwrap_or(NODE_PROXY_PORT))),
    node_available: Arc::new(AtomicBool::new(node_proxy_port.is_some())),
    ..Default::default()
  };
  let router = router(state);
  let listener = std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("bind 127.0.0.1:{port}: {e}"))?;
  std::thread::spawn(move || {
    let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
      Ok(rt) => rt,
      Err(e) => {
        eprintln!("[backend] tokio runtime failed: {e}");
        return;
      }
    };
    rt.block_on(async move {
      let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
      if let Err(e) = axum::serve(listener, router).await {
        eprintln!("[backend] serve error: {e}");
      }
    });
  });
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Network test — real oEmbed call. Run with:
  /// `cargo test --release -- --ignored`
  #[tokio::test]
  #[ignore]
  async fn quick_info_serves_json_with_cors() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = BackendState {
      node_proxy_url: Arc::new("http://127.0.0.1:3022".to_string()),
      node_available: Arc::new(AtomicBool::new(false)),
      ..Default::default()
    };
    let app = router(state);
    tokio::spawn(async move {
      let _ = axum::serve(listener, app).await;
    });

    let client = reqwest::Client::new();
    let resp = client
      .get(format!(
        "http://127.0.0.1:{port}/api/info/quick?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DKOpTWx1Eou4"
      ))
      .send()
      .await
      .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");
    let j: Value = resp.json().await.unwrap();
    assert_eq!(j["id"], "KOpTWx1Eou4");
    assert!(!j["title"].as_str().unwrap_or("").is_empty());
    assert!(j.get("error").is_none());
  }
  /// Network test - real yt-dlp run. Run with:
  /// `cargo test --release -- --ignored`
  #[tokio::test]
  #[ignore]
  async fn full_info_serves_formats_with_cors() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = BackendState {
      node_proxy_url: Arc::new("http://127.0.0.1:3022".to_string()),
      node_available: Arc::new(AtomicBool::new(false)),
      ..Default::default()
    };
    let app = router(state);
    tokio::spawn(async move {
      let _ = axum::serve(listener, app).await;
    });

    let client = reqwest::Client::new();
    let resp = client
      .get(format!(
        "http://127.0.0.1:{port}/api/info?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DKOpTWx1Eou4"
      ))
      .send()
      .await
      .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");
    let j: Value = resp.json().await.unwrap();
    assert_eq!(j["id"], "KOpTWx1Eou4");
    assert_eq!(j["bestOptions"].as_array().map(|a| a.len()).unwrap_or(0), 3);
    assert!(j["formats"].as_array().map(|a| a.len()).unwrap_or(0) > 0);
    assert!(j.get("error").is_none());
  }

  /// Network test - sequential cache hit + concurrent requests both succeed.
  #[tokio::test]
  #[ignore]
  async fn full_info_cache_and_concurrent_ok() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = router(BackendState::default());
    tokio::spawn(async move {
      let _ = axum::serve(listener, app).await;
    });

    let client = reqwest::Client::new();
    let url = format!(
      "http://127.0.0.1:{port}/api/info?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DKOpTWx1Eou4"
    );

    let first = client.get(&url).send().await.unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    // Second sequential call - should hit the 30-min cache.
    let second = client.get(&url).send().await.unwrap();
    assert_eq!(second.status(), StatusCode::OK);

    // Two concurrent calls - both succeed (cache hit or shared in-flight run).
    let (a, b) = tokio::join!(client.get(&url).send(), client.get(&url).send());
    assert_eq!(a.unwrap().status(), StatusCode::OK);
    assert_eq!(b.unwrap().status(), StatusCode::OK);
  }

}
