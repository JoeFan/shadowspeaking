from pathlib import Path
import json
import os
import platform

root = Path(__file__).resolve().parents[1]
config_path = root / "src-tauri" / "tauri.conf.json"
config = json.loads(config_path.read_text(encoding="utf-8"))

bundle = config.setdefault("bundle", {})
resources = bundle.setdefault("resources", [])
if isinstance(resources, dict):
    resources = list(resources.keys())

# Remove old source-worker resource entries: production uses the frozen sidecar.
resources = [
    item for item in resources
    if item not in ("../python/worker.py", "../python/requirements.txt")
]

if os.name == "nt":
    sidecar = "../src-tauri/sidecars/shadow-worker.exe"
else:
    sidecar = "../src-tauri/sidecars/shadow-worker"

# Paths are relative to src-tauri/tauri.conf.json.
# src-tauri/sidecars is directly under src-tauri, so use "sidecars/...".
sidecar = "sidecars/shadow-worker.exe" if os.name == "nt" else "sidecars/shadow-worker"

if sidecar not in resources:
    resources.append(sidecar)

# Keep bundled FFmpeg resources if they were configured earlier.
bundle["resources"] = resources
config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

print("Configured Tauri resources:")
for item in resources:
    print(" -", item)
