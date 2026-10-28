#!/usr/bin/env python3
"""Validate the extension and build the Chrome Web Store upload zip.

    python tools/package.py

Checks that the manifest, its icons and every file it references are present
and well formed, then writes dist/pipdesk-<version>.zip containing only what
Chrome needs. Development files (tests, docs, tools, store images, git data)
stay out of the package.
"""

import json
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# Folders Chrome does not need and that would slow the review down or leak
# internal notes.
EXCLUDE_DIRS = {
    ".git",
    ".freebuff",
    ".orthex",
    "node_modules",
    "dist",
    "store",
    "docs",
    "tools",
    "tests",
}
EXCLUDE_FILES = {
    ".gitignore",
    "AGENTS.md",
    "README.md",
}

NAME_LIMIT = 45
SUMMARY_LIMIT = 132
ICON_SIZES = (16, 48, 128)

errors = []
warnings = []


def fail(message):
    errors.append(message)


def warn(message):
    warnings.append(message)


def png_size(path):
    """Width and height from a PNG header; no imaging library needed."""
    with open(path, "rb") as handle:
        head = handle.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    if head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def walk():
    files = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_dir():
            continue
        rel = path.relative_to(ROOT)
        parts = rel.parts
        if any(part in EXCLUDE_DIRS for part in parts[:-1]):
            continue
        if parts[0] in EXCLUDE_FILES or rel.name in EXCLUDE_FILES:
            continue
        if path.suffix in {".pyc"} or "__pycache__" in parts:
            continue
        files.append(rel)
    return files


def check_manifest(manifest, files):
    name = manifest.get("name", "")
    if len(name) > NAME_LIMIT:
        fail(f'manifest name is {len(name)} characters (limit {NAME_LIMIT}): {name}')

    summary = manifest.get("description", "")
    if len(summary) > SUMMARY_LIMIT:
        fail(
            f"manifest description is {len(summary)} characters "
            f"(limit {SUMMARY_LIMIT})"
        )

    if manifest.get("manifest_version") != 3:
        fail("manifest_version must be 3")

    version = str(manifest.get("version", ""))
    if not re.fullmatch(r"\d{1,5}(\.\d{1,5}){0,3}", version):
        fail(f"version {version!r} is not a Chrome-compatible version number")

    if not manifest.get("author"):
        warn("manifest has no author")

    for group in (manifest.get("icons", {}), manifest.get("action", {}).get("default_icon", {})):
        for size, rel in (group or {}).items():
            path = ROOT / rel
            if not path.exists():
                fail(f"icon file missing: {rel}")
                continue
            actual = png_size(path)
            if actual != (int(size), int(size)):
                fail(f"icon {rel} is {actual}, expected {int(size)}x{int(size)}")

    sw = manifest.get("background", {}).get("service_worker")
    if not sw or Path(sw) not in files:
        fail(f"service worker missing: {sw}")

    for entry in manifest.get("content_scripts", []):
        for rel in entry.get("js", []) + entry.get("css", []):
            if Path(rel) not in files:
                fail(f"declared content script file missing: {rel}")

    for entry in manifest.get("web_accessible_resources", []):
        for rel in entry.get("resources", []):
            if Path(rel) not in files:
                fail(f"web accessible resource missing: {rel}")


def check_sources(files):
    js_files = [rel for rel in files if rel.suffix == ".js"]
    html_files = [rel for rel in files if rel.suffix == ".html"]

    network = re.compile(r"\bfetch\s*\(|XMLHttpRequest|\bnew\s+WebSocket\b")
    for rel in js_files:
        text = (ROOT / rel).read_text(encoding="utf-8")
        if network.search(text):
            fail(f"{rel} makes a network call; the store listing says it never does")
        if len(text.splitlines()) > 1200 and rel.parts[0] != "background":
            warn(f"{rel} is {len(text.splitlines())} lines")

    # Every file a page references must be inside the package.
    referenced = re.compile(r'(?:src|href)\s*=\s*"([^"#]+)"')
    for rel in html_files:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for target in referenced.findall(text):
            if target.startswith(("http://", "https://", "data:")):
                fail(f"{rel} loads remote content: {target}")
                continue
            resolved = (rel.parent / target).resolve()
            try:
                inside = resolved.relative_to(ROOT)
            except ValueError:
                fail(f"{rel} references a file outside the project: {target}")
                continue
            if not resolved.exists():
                fail(f"{rel} references a missing file: {target}")
            elif inside not in files:
                fail(f"{rel} references a file the package excludes: {target}")


def check_listing(manifest):
    listing = ROOT / "docs" / "CHROME-WEB-STORE.md"
    if not listing.exists():
        warn("docs/CHROME-WEB-STORE.md is missing; the listing copy lives there")
        return
    text = listing.read_text(encoding="utf-8")
    if manifest["name"] not in text:
        warn("the manifest name does not appear in the store listing copy")
    if not re.search(r"Float a tab", text):
        warn("the listing copy does not open with the feature summary")


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    files = walk()

    check_manifest(manifest, files)
    check_sources(files)
    check_listing(manifest)

    if warnings:
        print("warnings:")
        for message in warnings:
            print(f"  - {message}")
    if errors:
        print("failed:")
        for message in errors:
            print(f"  - {message}")
        return 1

    version = manifest["version"]
    DIST.mkdir(exist_ok=True)
    target = DIST / f"pipdesk-{version}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as bundle:
        for rel in files:
            bundle.write(ROOT / rel, rel.as_posix())

    listed = "\n".join(f"  {rel.as_posix()}" for rel in files)
    print(f"ok: {len(files)} files -> {target.relative_to(ROOT)}")
    print(f"size: {target.stat().st_size} bytes")
    print("package contains:")
    print(listed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
