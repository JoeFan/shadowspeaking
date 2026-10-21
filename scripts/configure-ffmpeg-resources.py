from pathlib import Path
import json, os
root = Path(__file__).resolve().parents[1]
path = root / "src-tauri" / "tauri.conf.json"
cfg = json.loads(path.read_text())
resources = cfg.setdefault("bundle", {}).setdefault("resources", [])
wanted = ["../python/worker.py", "../python/requirements.txt"]
wanted += ["../bin/ffmpeg.exe", "../bin/ffprobe.exe"] if os.name == "nt" else ["../bin/ffmpeg", "../bin/ffprobe"]
for item in wanted:
    if item not in resources:
        resources.append(item)
path.write_text(json.dumps(cfg, indent=2))
print("\n".join(resources))
