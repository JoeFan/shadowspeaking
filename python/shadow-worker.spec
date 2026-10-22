# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = []
binaries = []
hiddenimports = []

# Faster-Whisper pulls native/runtime dependencies through CTranslate2,
# tokenizers, huggingface_hub and PyAV. Collect them explicitly because
# dynamic imports can otherwise be missed by PyInstaller.
for package in [
    "faster_whisper",
    "ctranslate2",
    "tokenizers",
    "huggingface_hub",
    "av",
]:
    try:
        d, b, h = collect_all(package)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# Common dynamically imported dependencies.
for package in [
    "numpy",
    "yaml",
    "requests",
    "tqdm",
    "filelock",
    "fsspec",
    "packaging",
]:
    try:
        hiddenimports += collect_submodules(package)
    except Exception:
        pass

a = Analysis(
    ["shadow_worker_entry.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas + [("worker.py", ".")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="shadow-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
