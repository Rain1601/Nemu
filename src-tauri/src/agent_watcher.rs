use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const RECENT_CUTOFF_SECS: u64 = 60 * 60; // 1 hour: only keep agents whose mtime is within this window
const EMIT_THROTTLE_MS: u128 = 300;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub tool: String,
    pub project: String,
    pub cwd: String,
    pub path: String,
    pub last_active_ms: u64,
    pub first_seen_ms: u64,
}

type AgentMap = Arc<Mutex<HashMap<String, AgentInfo>>>;

pub struct AgentWatcher {
    state: AgentMap,
}

impl AgentWatcher {
    pub fn spawn(app: AppHandle) -> Self {
        let state: AgentMap = Arc::new(Mutex::new(HashMap::new()));
        let state_for_thread = state.clone();

        thread::spawn(move || {
            let home = match dirs::home_dir() {
                Some(h) => h,
                None => {
                    eprintln!("agent_watcher: no home dir");
                    return;
                }
            };

            let claude_root = home.join(".claude/projects");
            let codex_root = home.join(".codex/sessions");

            // Initial scan
            if claude_root.exists() {
                scan_claude(&claude_root, &state_for_thread);
            }
            if codex_root.exists() {
                scan_codex(&codex_root, &state_for_thread);
            }
            emit_agents(&app, &state_for_thread);

            // Set up filesystem watcher
            let (tx, rx) = channel();
            let mut watcher: RecommendedWatcher = match Watcher::new(tx, Config::default()) {
                Ok(w) => w,
                Err(err) => {
                    eprintln!("agent_watcher: failed to create watcher: {err}");
                    return;
                }
            };

            if claude_root.exists() {
                if let Err(err) = watcher.watch(&claude_root, RecursiveMode::Recursive) {
                    eprintln!("agent_watcher: claude watch failed: {err}");
                }
            }
            if codex_root.exists() {
                if let Err(err) = watcher.watch(&codex_root, RecursiveMode::Recursive) {
                    eprintln!("agent_watcher: codex watch failed: {err}");
                }
            }

            let mut last_emit = Instant::now() - Duration::from_secs(1);
            while let Ok(res) = rx.recv() {
                let event = match res {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let mut changed = false;
                for path in event.paths {
                    if !path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e == "jsonl")
                        .unwrap_or(false)
                    {
                        continue;
                    }
                    if is_subagent(&path) {
                        continue;
                    }

                    let info = if path_under(&path, &claude_root) {
                        parse_claude(&path)
                    } else if path_under(&path, &codex_root) {
                        parse_codex(&path)
                    } else {
                        None
                    };

                    if let Some(info) = info {
                        upsert(&state_for_thread, info);
                        changed = true;
                    }
                }

                if changed && last_emit.elapsed().as_millis() >= EMIT_THROTTLE_MS {
                    emit_agents(&app, &state_for_thread);
                    last_emit = Instant::now();
                }
            }
        });

        AgentWatcher { state }
    }

    pub fn snapshot(&self) -> Vec<AgentInfo> {
        let map = self.state.lock().unwrap();
        let mut vec: Vec<AgentInfo> = map.values().cloned().collect();
        vec.sort_by(|a, b| {
        b.first_seen_ms
            .cmp(&a.first_seen_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
        vec
    }
}

fn emit_agents(app: &AppHandle, state: &AgentMap) {
    let map = state.lock().unwrap();
    let mut list: Vec<AgentInfo> = map.values().cloned().collect();
    list.sort_by(|a, b| b.last_active_ms.cmp(&a.last_active_ms));
    drop(map);
    let _ = app.emit("agents-updated", list);
}

fn is_subagent(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str() == "subagents")
}

fn path_under(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    let dur = mtime.duration_since(UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as u64)
}

fn project_basename(cwd: &str) -> String {
    let trimmed = cwd.trim_end_matches('/');
    Path::new(trimmed)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| trimmed.to_string())
}

fn decode_claude_cwd(encoded: &str) -> String {
    // "-Users-rain-PycharmProjects-Nemu"  →  "/Users/rain/PycharmProjects/Nemu"
    encoded.replace('-', "/")
}

fn parse_claude(path: &Path) -> Option<AgentInfo> {
    let last_active_ms = mtime_ms(path)?;
    let uuid = path.file_stem()?.to_string_lossy().to_string();
    let encoded = path.parent()?.file_name()?.to_string_lossy().to_string();
    let cwd = decode_claude_cwd(&encoded);
    let project = project_basename(&cwd);
    Some(AgentInfo {
        id: format!("claude:{uuid}"),
        tool: "claude".to_string(),
        project,
        cwd,
        path: path.to_string_lossy().to_string(),
        last_active_ms,
        first_seen_ms: last_active_ms,
    })
}

fn parse_codex(path: &Path) -> Option<AgentInfo> {
    let last_active_ms = mtime_ms(path)?;
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let id = format!("codex:{stem}");

    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;

    let parsed: serde_json::Value = serde_json::from_str(first_line.trim()).ok()?;
    let cwd = parsed
        .get("payload")
        .and_then(|p| p.get("cwd"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let project = if cwd.is_empty() {
        "codex".to_string()
    } else {
        project_basename(&cwd)
    };

    Some(AgentInfo {
        id,
        tool: "codex".to_string(),
        project,
        cwd,
        path: path.to_string_lossy().to_string(),
        last_active_ms,
        first_seen_ms: last_active_ms,
    })
}

fn upsert(state: &AgentMap, mut info: AgentInfo) {
    let mut map = state.lock().unwrap();
    if let Some(existing) = map.get(&info.id) {
        info.first_seen_ms = existing.first_seen_ms;
    }
    map.insert(info.id.clone(), info);
}

fn cutoff_ms() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    now.saturating_sub(RECENT_CUTOFF_SECS * 1000)
}

fn scan_claude(root: &Path, state: &AgentMap) {
    let cutoff = cutoff_ms();
    for entry in WalkDir::new(root)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path: PathBuf = entry.path().to_path_buf();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if is_subagent(&path) {
            continue;
        }
        if let Some(info) = parse_claude(&path) {
            if info.last_active_ms >= cutoff {
                upsert(state, info);
            }
        }
    }
}

fn scan_codex(root: &Path, state: &AgentMap) {
    let cutoff = cutoff_ms();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path: PathBuf = entry.path().to_path_buf();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(info) = parse_codex(&path) {
            if info.last_active_ms >= cutoff {
                upsert(state, info);
            }
        }
    }
}

#[tauri::command]
pub fn list_agents(state: tauri::State<'_, AgentWatcher>) -> Vec<AgentInfo> {
    state.snapshot()
}
