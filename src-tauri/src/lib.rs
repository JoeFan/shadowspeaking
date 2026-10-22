use serde_json::Value;
use std::path::{Path};
use tauri::{AppHandle, Manager};

fn resolve_dev_worker_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python")
        .join("worker.py")
}

fn resolve_sidecar_path(app: &AppHandle) -> Result<Option<std::path::PathBuf>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not resolve app resource directory: {e}"))?;

    let exe_name = if cfg!(target_os = "windows") {
        "shadow-worker.exe"
    } else {
        "shadow-worker"
    };

    let candidates = [
        resource_dir.join("sidecars").join(exe_name),
        resource_dir.join("_up_").join("sidecars").join(exe_name),
        resource_dir.join(exe_name),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Ok(Some(candidate));
        }
    }

    Ok(None)
}

fn resolve_python() -> String {
    if let Ok(value) = std::env::var("SHADOWING_PYTHON") {
        if !value.trim().is_empty() {
            return value;
        }
    }

    let project_venv = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".venv")
        .join(if cfg!(target_os = "windows") {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });

    if project_venv.exists() {
        return project_venv.to_string_lossy().to_string();
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

fn run_worker(app: &AppHandle, args: &[String]) -> Result<Value, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?;

    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Could not create app data directory: {e}"))?;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {e}"))?;

    // Production path: use the frozen native worker sidecar. No Python runtime
    // is required on the user's machine.
    let output = if let Some(sidecar) = resolve_sidecar_path(app)? {
        std::process::Command::new(&sidecar)
            .arg("--data-dir")
            .arg(&data_dir)
            .args(args)
            .env("SHADOWING_RESOURCE_DIR", &resource_dir)
            .output()
            .map_err(|e| {
                format!(
                    "Could not start bundled Shadow worker '{}': {}",
                    sidecar.display(),
                    e
                )
            })?
    } else {
        // Development fallback: run python/worker.py from the source tree.
        let worker = resolve_dev_worker_path();
        if !worker.exists() {
            return Err(
                "Bundled shadow-worker was not found, and the development worker.py is unavailable. \
                 Build the native sidecar before creating the installer."
                    .to_string(),
            );
        }

        let python = resolve_python();

        std::process::Command::new(&python)
            .arg(&worker)
            .arg("--data-dir")
            .arg(&data_dir)
            .args(args)
            .env("SHADOWING_RESOURCE_DIR", &resource_dir)
            .output()
            .map_err(|e| {
                format!(
                    "Could not start development Python worker using '{}' and '{}': {}",
                    python,
                    worker.display(),
                    e
                )
            })?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        return Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Shadow worker exited with status {}", output.status)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Invalid Shadow worker response: {e}\n{}", stdout.trim()))
}

async fn run_worker_async(
    app: AppHandle,
    args: Vec<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_worker(&app, &args))
        .await
        .map_err(|e| format!("Worker task failed: {e}"))?
}

#[tauri::command]
async fn open_media(
    app: AppHandle,
    path: String,
) -> Result<Value, String> {
    if !Path::new(&path).exists() {
        return Err("File does not exist".into());
    }

    run_worker_async(
        app,
        vec!["open".into(), "--path".into(), path],
    )
    .await
}

#[tauri::command]
async fn recover_legacy_shadow(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "legacy".into(),
            "--id".into(),
            id,
            "--path".into(),
            path,
        ],
    )
    .await
}

#[tauri::command]
async fn prepare_shadow(
    app: AppHandle,
    id: String,
    language: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "shadow".into(),
            "--id".into(),
            id,
            "--language".into(),
            language,
        ],
    )
    .await
}

#[tauri::command]
async fn list_lessons(app: AppHandle) -> Result<Value, String> {
    run_worker_async(app, vec!["list".into()]).await
}

#[tauri::command]
async fn get_lesson(
    app: AppHandle,
    id: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec!["get".into(), "--id".into(), id],
    )
    .await
}

#[tauri::command]
async fn save_position(
    app: AppHandle,
    id: String,
    position: f64,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "position".into(),
            "--id".into(),
            id,
            "--position".into(),
            position.to_string(),
        ],
    )
    .await
}

#[tauri::command]
async fn delete_lesson(
    app: AppHandle,
    id: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec!["delete".into(), "--id".into(), id],
    )
    .await
}

#[tauri::command]
async fn export_shadow_package(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "export".into(),
            "--id".into(),
            id,
            "--path".into(),
            path,
        ],
    )
    .await
}

#[tauri::command]
async fn import_shadow_package(
    app: AppHandle,
    path: String,
) -> Result<Value, String> {
    if !Path::new(&path).exists() {
        return Err("Shadow Lesson file does not exist.".into());
    }

    run_worker_async(
        app,
        vec!["import".into(), "--path".into(), path],
    )
    .await
}

#[tauri::command]
async fn update_segment_text(
    app: AppHandle,
    id: String,
    segment_id: i64,
    text: String,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "edit-text".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
            "--text".into(),
            text,
        ],
    )
    .await
}

#[tauri::command]
async fn reset_segment_text(
    app: AppHandle,
    id: String,
    segment_id: i64,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "reset-text".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
        ],
    )
    .await
}

#[tauri::command]
async fn set_segment_like(
    app: AppHandle,
    id: String,
    segment_id: i64,
    liked: bool,
) -> Result<Value, String> {
    run_worker_async(
        app,
        vec![
            "like".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
            "--liked".into(),
            if liked { "true".into() } else { "false".into() },
        ],
    )
    .await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_dialog::init()
        )
        .invoke_handler(
            tauri::generate_handler![
                open_media,
                recover_legacy_shadow,
                prepare_shadow,
                list_lessons,
                get_lesson,
                save_position,
                delete_lesson,
                export_shadow_package,
                import_shadow_package,
                update_segment_text,
                reset_segment_text,
                set_segment_like
            ]
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "Tauri error"
        );
}
