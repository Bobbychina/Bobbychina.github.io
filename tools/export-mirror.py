"""Export only public static files from the running site; never copy deployment roots."""
import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

PORTAL_FILES = (
    "index.html", "portal.index.html", "favicon.svg", "favicon.ico",
    "apple-touch-icon.png", "icon-32.png", "icon-192.png", "icon-512.png",
    "beta-notice.js", "easter-egg.js", "mac-block.js", "LICENSE",
)
PORTAL_DIRS = ("assets", "games", "i18n", "secret", "sponsor", "og", "mail")
EXTENSIONS = {
    ".html", ".js", ".mjs", ".css", ".json", ".png", ".jpg", ".jpeg", ".svg",
    ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".mp3", ".ogg",
    ".wav", ".wasm", ".glb", ".gltf", ".bin", ".xml", ".webmanifest",
}


def collect(portal, blog):
    files = {}

    def add(root, relative):
        path = root / relative
        # Never follow symlinks, hidden paths, development files or old removed games.
        if any(p.startswith(".") or p in {"node_modules", "tools", "docs", "dreamcore"}
               for p in relative.parts):
            return
        if any((root / Path(*relative.parts[:i])).is_symlink()
               for i in range(1, len(relative.parts) + 1)):
            return
        if not path.is_file() or (path.suffix.lower() not in EXTENSIONS
                                  and not path.name.upper().startswith(("LICENSE", "COPYING"))):
            return
        files[relative.as_posix()] = path

    for name in PORTAL_FILES:
        add(portal, Path(name))
    for name in PORTAL_DIRS:
        for path in (portal / name).rglob("*"):
            add(portal, path.relative_to(portal))
    for name in ("posts", "media"):
        for path in (blog / name).rglob("*"):
            add(blog, path.relative_to(blog))
    for name in ("feed.xml", "sitemap.xml"):
        add(blog, Path(name))
    for required in ("index.html", "games/index.html", "posts/index.html",
                     "assets/site.js", "i18n/zh-CN.js", "i18n/zh-TW.js", "i18n/en.js"):
        if required not in files:
            raise ValueError(f"Missing public file: {required}")
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--portal", type=Path, default=Path("/var/www/portal"))
    parser.add_argument("--blog", type=Path, default=Path("/opt/stockgame/blog-dist"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    files = collect(args.portal, args.blog)
    manifest = {}
    with tarfile.open(args.out, "x:gz") as archive:
        for name, path in sorted(files.items()):
            # Hash the exact bytes put in the archive, even during a concurrent release.
            data = path.read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
            manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        payload = json.dumps({"source": "https://bobbycn.cc", "files": manifest},
                             ensure_ascii=False, indent=2).encode("utf-8")
        info = tarfile.TarInfo("mirror-source.json")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
    print(json.dumps({"files": len(files), "bytes": sum(f["bytes"] for f in manifest.values()),
                      "archive": str(args.out)}))


if __name__ == "__main__":
    main()
