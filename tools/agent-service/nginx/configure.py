"""Install the portal agent routes into an existing nginx tree; never reload nginx."""

import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


SOURCE = Path(__file__).resolve().parent
SNIPPETS = "/etc/nginx/snippets/"
PUBLIC_FILES = {
    "/robots.txt": "text/plain",
    "/auth.md": "text/markdown",
    "/.well-known/api-catalog": "application/linkset+json",
    "/.well-known/blog-views.openapi.json": "application/json",
    "/.well-known/oauth-authorization-server": "application/json",
    "/.well-known/oauth-protected-resource": "application/json",
    "/.well-known/agent-skills/index.json": "application/json",
    "/.well-known/agent-skills/read-blog-views/SKILL.md": "text/markdown",
    "/.well-known/mcp/server-card.json": "application/json",
    "/.well-known/agent-card.json": "application/json",
    "/.well-known/agent-directory": "application/json",
    "/.well-known/ard.json": "application/ard+json",
}
PUBLIC_EDGE = 'add_header Cloudflare-CDN-Cache-Control $agent_edge_override always;'
EDGE_MAP = '''
map $agent_public_get $agent_edge_override {
    default "";
    1 no-store;
}
'''
LEGACY_EDGE_MAP = '''
map $agent_public_get $agent_edge_or_existing {
    default $portal_edge_cache;
    1 no-store;
}
'''


def read(path):
    return path.read_bytes().decode("utf-8")


def template(name):
    return read(SOURCE / name).rstrip() + "\n"


def include(name):
    return "include " + SNIPPETS + name + ";"


def metadata_locations():
    blocks = [template("locations.conf").rstrip()]
    for uri, media_type in PUBLIC_FILES.items():
        path = uri if uri != "/.well-known/ard.json" else "/.well-known/agent-directory"
        blocks.append(
            f"location = {uri} {{\n"
            f"    {include('agent-readiness-metadata.conf')}\n"
            f"    default_type {media_type};\n"
            f"    try_files {path} =404;\n"
            "}"
        )
    return "\n\n".join(blocks) + "\n"


def target_location(text, name, is_portal=False):
    # Inline if blocks are present inside these locations. Anchor the closing
    # brace to the location's indentation and validate the original guard.
    pattern = re.compile(
        r"^(?P<indent>[ \t]*)location[ \t]+" + re.escape(name) +
        r"[ \t]*\{[ \t]*\r?\n(?P<body>.*?)^(?P=indent)\}[ \t]*\r?$", re.M | re.S)
    matches = [m for m in pattern.finditer(text)
               if re.match(r"\s*if\s*\(\$block_mac\)\s*\{\s*return 403;\s*\}", m["body"])]
    if len(matches) != 1:
        raise ValueError(f"expected one guarded location {name}, found {len(matches)}")
    match = matches[0]
    if is_portal:
        preceding = text[:match.start()]
        starts = list(re.finditer(r"(?m)^[ \t]*server[ \t]*\{", preceding))
        server = preceding[starts[-1].start():] if starts else ""
        if not re.search(r"(?m)^\s*listen\s+(?:\S+:)?443\b", server) or not re.search(
                r"(?m)^\s*server_name\s+[^;]*\bbobbycn[.]cc\b", server):
            raise ValueError(f"{name} is outside the expected portal HTTPS server")
    return match


def patch_location(text, name, has_legacy, is_portal=False):
    match = target_location(text, name, is_portal)
    body = match["body"]
    if name == "^~ /posts/" and not re.search(r"(?m)^\s*alias /opt/stockgame/blog-dist/posts/;", body):
        raise ValueError("unexpected blog alias")
    guard = re.search(r"(?m)^([ \t]*)if\s*\(\$block_mac\)\s*\{\s*return 403;\s*\}[ \t]*(?=\r?$)", body)
    if not guard:
        raise ValueError(f"unexpected platform guard in {name}")
    indent = guard.group(1)
    page = include("agent-readiness-page.conf")
    if page not in body:
        body = body[:guard.end()] + "\n" + indent + page + body[guard.end():]
    elif body.count(page) != 1 or body.index(page) < guard.end():
        raise ValueError(f"unexpected agent page include in {name}")

    ordinary = include("portal-cache.conf")
    legacy = include("agent-readiness-cache.conf")
    if ordinary in body or legacy in body:
        if not has_legacy:
            raise ValueError("missing or changed portal-cache.conf")
        body = body.replace(ordinary, legacy)
    else:
        if not re.search(r'(?im)^\s*add_header\s+Cache-Control\s+"no-cache"(?:\s+always)?;', body):
            raise ValueError(f"unexpected Cache-Control configuration in {name}")
        if not re.search(r"(?im)^\s*add_header\s+Cloudflare-CDN-Cache-Control\b", body):
            body = body.replace(page, page + "\n" + indent + PUBLIC_EDGE)
        elif (PUBLIC_EDGE not in body and not re.search(
                r'(?im)^\s*add_header\s+Cloudflare-CDN-Cache-Control\s+"?no-store"?(?:\s+always)?;', body)):
            raise ValueError(f"unexpected edge cache configuration in {name}")
    return text[:match.start("body")] + body + text[match.end("body"):]


def outputs(root):
    portal = root / "conf.d/portal.conf"
    blog = root / "snippets/blog.conf"
    raw_portal, raw_blog = read(portal), read(blog)
    cache_include = include("portal-cache.conf")
    legacy_include = include("agent-readiness-cache.conf")
    locations = [(raw_portal, "= /index.html"), (raw_portal, "/"), (raw_blog, "^~ /posts/")]
    use_legacy = any(any(item in target_location(text, name)["body"]
                         for item in (cache_include, legacy_include)) for text, name in locations)
    files = {}
    if use_legacy:
        cache = read(root / "snippets/portal-cache.conf")
        source = "add_header Cloudflare-CDN-Cache-Control $portal_edge_cache always;"
        if cache.count(source) != 1:
            raise ValueError("unrecognized shared cache policy")
        files[root / "snippets/agent-readiness-cache.conf"] = cache.replace(
            source, source.replace("$portal_edge_cache", "$agent_edge_or_existing"))
    edited = patch_location(raw_portal, "= /index.html", use_legacy, True)
    edited = patch_location(edited, "/", use_legacy, True)
    addition = include("agent-readiness-locations.conf")
    if addition not in edited:
        anchor = target_location(edited, "= /index.html", True)
        edited = edited[:anchor.start()] + anchor["indent"] + addition + "\n\n" + edited[anchor.start():]
    elif edited.count(addition) != 1:
        raise ValueError("duplicate agent location include")

    routes = metadata_locations()
    route_names = re.findall(r"(?m)^location = (\S+)", routes)
    for route in route_names:
        existing = r"(?m)^[ \t]*location\s+=\s+" + re.escape(route) + r"\s*\{"
        if re.search(existing, raw_portal) or re.search(existing, raw_blog):
            raise ValueError(f"existing route requires review: {route}")

    files[root / "conf.d/01-agent-readiness-maps.conf"] = (
        template("maps.conf") + EDGE_MAP + (LEGACY_EDGE_MAP if use_legacy else ""))
    for name in ("page", "rpc", "metadata"):
        files[root / f"snippets/agent-readiness-{name}.conf"] = template(name + ".conf")
    files[root / "snippets/agent-readiness-locations.conf"] = routes
    files[blog] = patch_location(raw_blog, "^~ /posts/", use_legacy)
    files[portal] = edited
    return files


def replace(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        temporary = Path(tmp.name)
    try:
        temporary.write_bytes(content.encode("utf-8"))
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/etc/nginx"),
                        help="staged or live nginx tree; installed includes refer to /etc/nginx")
    parser.add_argument("--check", action="store_true", help="list planned files without changing them")
    args = parser.parse_args()
    planned = outputs(args.root.resolve())
    for path, content in planned.items():
        unchanged = path.is_file() and read(path) == content
        print(f"{'unchanged' if unchanged else 'update' if path.exists() else 'create'} {path}")
    if not args.check:
        for path, content in planned.items():
            if not path.is_file() or read(path) != content:
                replace(path, content)


if __name__ == "__main__":
    main()
