use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn python_executable() -> String {
    std::env::var("SHADOWING_PYTHON")
        .unwrap_or_else(|_| "python3.12".to_string())
}

fn worker_path() -> Result<PathBuf, String> {
    let manifest =
        PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let path = manifest
        .parent()
        .ok_or("Cannot resolve project root")?
        .join("python")
        .join("worker.py");

    if !path.exists() {
        return Err(
            format!(
                "Worker missing: {}",
                path.display()
            )
        );
    }

    Ok(path)
}

fn resolve_worker_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        let dev_worker = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..").join("python").join("worker.py");
        if dev_worker.exists() {
            return Ok(dev_worker);
        }
    }

    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Could not resolve app resource directory: {e}"))?;

    for candidate in [
        resource_dir.join("python").join("worker.py"),
        resource_dir.join("_up_").join("python").join("worker.py"),
        resource_dir.join("worker.py"),
    ] {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!("Bundled worker.py was not found under {}", resource_dir.display()))
}

fn resolve_python() -> String {
    if let Ok(value) = std::env::var("SHADOWING_PYTHON") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    if cfg!(target_os = "windows") { "python".into() } else { "python3".into() }
}

fn run_worker(app: &AppHandle, args: &[String]) -> Result<Value, String> {
    let python = resolve_python();
    let worker = resolve_worker_path(app)?;

    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Could not create app data directory: {e}"))?;

    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {e}"))?;

    let output = std::process::Command::new(&python)
        .arg(&worker)
        .arg("--data-dir")
        .arg(&data_dir)
        .args(args)
        .env("SHADOWING_RESOURCE_DIR", &resource_dir)
        .output()
        .map_err(|e| format!(
            "Could not start Python worker using '{}' and '{}': {}",
            python, worker.display(), e
        ))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() { stderr } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Python worker exited with status {}", output.status)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Invalid worker response: {e}\n{}", stdout.trim()))
}

#[tauri::command]
fn open_media(
    app: AppHandle,
    path: String,
) -> Result<Value, String> {
    if !Path::new(&path).exists() {
        return Err(
            "File does not exist".into()
        );
    }

    run_worker(
        &app,
        &[
            "open".into(),
            "--path".into(),
            path,
        ],
    )
}


#[tauri::command]
fn recover_legacy_shadow(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "legacy".into(),
            "--id".into(),
            id,
            "--path".into(),
            path,
        ],
    )
}

#[tauri::command]
async fn prepare_shadow(
    app: AppHandle,
    id: String,
    language: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_worker(
            &app,
            &[
                "shadow".into(),
                "--id".into(),
                id,
                "--language".into(),
                language,
            ],
        )
    })
    .await
    .map_err(|e| format!("Shadow worker task failed: {e}"))?
}

#[tauri::command]
fn list_lessons(
    app: AppHandle,
) -> Result<Value, String> {
    run_worker(
        &app,
        &["list".into()],
    )
}

#[tauri::command]
fn get_lesson(
    app: AppHandle,
    id: String,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "get".into(),
            "--id".into(),
            id,
        ],
    )
}

#[tauri::command]
fn save_position(
    app: AppHandle,
    id: String,
    position: f64,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "position".into(),
            "--id".into(),
            id,
            "--position".into(),
            position.to_string(),
        ],
    )
}

#[tauri::command]
fn delete_lesson(
    app: AppHandle,
    id: String,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "delete".into(),
            "--id".into(),
            id,
        ],
    )
}

#[tauri::command]
fn export_shadow_package(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "export".into(),
            "--id".into(),
            id,
            "--path".into(),
            path,
        ],
    )
}

#[tauri::command]
fn import_shadow_package(
    app: AppHandle,
    path: String,
) -> Result<Value, String> {
    if !Path::new(&path).exists() {
        return Err(
            "Shadow Lesson file does not exist."
                .into()
        );
    }

    run_worker(
        &app,
        &[
            "import".into(),
            "--path".into(),
            path,
        ],
    )
}


#[tauri::command]
fn update_segment_text(
    app: AppHandle,
    id: String,
    segment_id: i64,
    text: String,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "edit-text".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
            "--text".into(),
            text,
        ],
    )
}

#[tauri::command]
fn reset_segment_text(
    app: AppHandle,
    id: String,
    segment_id: i64,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "reset-text".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
        ],
    )
}

#[tauri::command]
fn set_segment_like(
    app: AppHandle,
    id: String,
    segment_id: i64,
    liked: bool,
) -> Result<Value, String> {
    run_worker(
        &app,
        &[
            "like".into(),
            "--id".into(),
            id,
            "--segment-id".into(),
            segment_id.to_string(),
            "--liked".into(),
            if liked { "true".into() } else { "false".into() },
        ],
    )
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
