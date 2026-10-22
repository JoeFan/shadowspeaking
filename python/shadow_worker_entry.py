import faster_whisper
import ctranslate2
import av
import tokenizers
import huggingface_hub

import runpy
from pathlib import Path

runpy.run_path(
    str(Path(__file__).with_name("worker.py")),
    run_name="__main__",
)