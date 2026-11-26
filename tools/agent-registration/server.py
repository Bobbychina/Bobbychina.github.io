"""Isolated anonymous registrations for the public site directory."""
import hashlib
import hmac
import html
import http.client
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import Counter
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ORIGIN = "https://bobbycn.cc"
RESOURCE = ORIGIN + "/.well-known/oauth-protected-resource/agent/directory"
TTL = 3600
CLAIM_TTL = 600
CAPACITY = 10000
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
SCOPE = ["directory.read"]


class Error(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def digest(value):
    return hashlib.sha256(value.encode()).digest()


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def secret(prefix):
    return prefix + secrets.token_urlsafe(32)


class Store:
    def __init__(self, filename):
        self.filename = filename
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS registrations (
                id TEXT PRIMARY KEY, credential BLOB UNIQUE NOT NULL,
                expires INTEGER NOT NULL, claim_token BLOB UNIQUE, claim_expires INTEGER NOT NULL,
                user_code BLOB UNIQUE, owner_token BLOB UNIQUE
            )""")
            db.execute("CREATE INDEX IF NOT EXISTS expiry ON registrations(expires)")

    @contextmanager
    def connect(self):
        with closing(sqlite3.connect(self.filename, timeout=3)) as db, db:
            yield db

    def prune(self, db, now):
        db.execute("DELETE FROM registrations WHERE expires <= ?", (now,))
        db.execute("UPDATE registrations SET claim_token=NULL, user_code=NULL "
                   "WHERE claim_token IS NOT NULL AND claim_expires <= ?", (now,))

    def register(self):
        now = int(time.time())
        identifier, credential, claim = secret("reg_"), secret("dir_"), secret("clm_")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self.prune(db, now)
            if db.execute("SELECT count(*) FROM registrations").fetchone()[0] >= CAPACITY:
                raise Error(503, "registration_capacity")
            db.execute("INSERT INTO registrations(id,credential,expires,claim_token,claim_expires) "
                       "VALUES (?,?,?,?,?)", (identifier, digest(credential), now+TTL, digest(claim), now+CLAIM_TTL))
        return dict(registration_id=identifier, registration_type="anonymous", credential_type="api_key",
                    credential=credential, credential_expires=iso(now+TTL), scopes=SCOPE,
                    claim_url=ORIGIN+"/agent/auth/claim", claim_token=claim,
                    claim_token_expires=iso(now+CLAIM_TTL), post_claim_scopes=SCOPE)

    def initiate_claim(self, token):
        now = int(time.time())
        code = "".join(secrets.choice(ALPHABET) for _ in range(12))
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id,claim_expires FROM registrations WHERE claim_token=? "
                             "AND claim_expires>? AND expires>?", (digest(token), now, now)).fetchone()
            if not row:
                raise Error(400, "invalid_claim_token")
            db.execute("UPDATE registrations SET user_code=? WHERE id=?", (digest(code), row[0]))
        return dict(registration_id=row[0], status="initiated", verification_uri=ORIGIN+"/agent/claim",
                    user_code="-".join(code[i:i+4] for i in (0,4,8)), expires_at=iso(row[1]))

    def claim(self, code):
        normalized = code.replace("-", "").strip().upper()
        if len(normalized) != 12 or any(c not in ALPHABET for c in normalized):
            raise Error(400, "invalid_user_code")
        owner = secret("own_")
        now = int(time.time())
        with self.connect() as db:
            changed = db.execute("UPDATE registrations SET claim_token=NULL,user_code=NULL,owner_token=? "
                                 "WHERE user_code=? AND expires>? AND claim_expires>?",
                                 (digest(owner), digest(normalized), now, now)).rowcount
        if not changed:
            raise Error(400, "invalid_user_code")
        return owner

    def authorize(self, value):
        with self.connect() as db:
            row = db.execute("SELECT 1 FROM registrations WHERE credential=? AND expires>?",
                             (digest(value), int(time.time()))).fetchone()
        if not row:
            raise Error(401, "invalid_token")

    def revoke(self, token):
        hashed = digest(token)
        with self.connect() as db:
            db.execute("DELETE FROM registrations WHERE credential=? OR owner_token=?", (hashed, hashed))


class RateLimits:
    """Fixed windows bound both inbound traffic and the number of in-memory keys."""
    limits = {"register": (12, 240), "claim": (30, 900), "directory": (180, 3600)}

    def __init__(self):
        self.salt = secrets.token_bytes(32)
        self.lock = threading.Lock()
        self.window = -1
        self.clients = Counter()
        self.totals = Counter()

    def allow(self, source, kind):
        client = hmac.digest(self.salt, source.encode(), "sha256")[:12]
        with self.lock:
            now = int(time.monotonic() // 60)
            if now != self.window:
                self.totals.clear()
                self.clients.clear()
                self.window = now
            local, total = self.limits[kind]
            key = (kind, client)
            if self.totals[kind] >= total or self.clients[key] >= local:
                raise Error(429, "rate_limited")
            self.clients[key] += 1
            self.totals[kind] += 1


def search_directory(query):
    # The request is generated locally. It never carries the caller's cookies or credentials.
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "search_site_directory", "arguments": {"query": query}}}
    try:
        with closing(http.client.HTTPConnection("127.0.0.1", 18746, timeout=4)) as conn:
            conn.request("POST", "/mcp", json.dumps(request), {"Content-Type": "application/json"})
            res = conn.getresponse()
            if res.status != 200:
                raise ValueError("RPC status")
            raw = res.read(131073)
            if len(raw) > 131072:
                raise ValueError("RPC size")
            result = json.loads(raw)["result"]["structuredContent"]["entries"]
            if not isinstance(result, list):
                raise ValueError("RPC result")
            return {"entries": result}
    except (OSError, http.client.HTTPException, ValueError, TypeError, KeyError):
        raise Error(502, "directory_unavailable") from None


FORM = """
<h1>领取目录代理的撤销权</h1>
<p>仅处理潮汐太空港的公开目录凭证。请核对代理给你的领取码。确认后，本页会显示一次专用撤销密钥。</p>
<form method="post" action="/agent/claim" autocomplete="off">
<label>领取码 <input name="code" required maxlength="14" placeholder="XXXX-XXXX-XXXX"></label>
<label><input type="checkbox" required name="confirm" value="yes">我确认领取此目录代理的撤销权</label>
<button>确认领取</button></form>
<h2>撤销目录凭证</h2>
<form method="post" action="/agent/claim/revoke" autocomplete="off">
<label>撤销密钥 <input type="password" name="owner_token" required maxlength="96"></label>
<label><input type="checkbox" required name="confirm" value="yes">我确认立即撤销凭证</label>
<button>确认撤销</button></form>"""


def human_page(content):
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>目录代理凭证 · 潮汐太空港</title><main>' + content + '</main></html>').encode()


def unique_fields(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("duplicate field")
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "Directory"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass  # URLs, forms and request headers must never be logged.

    def setup(self):
        super().setup()
        self.connection.settimeout(8)

    def send_result(self, status, data=None, mime="application/json", headers=None):
        if data is None:
            data = b""
        elif not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        # Browsers need a same-origin referrer policy to send Origin on form navigation.
        form_page = mime == "text/html" and self.command in ("GET", "HEAD")
        self.send_header("Referrer-Policy", "same-origin" if form_page else "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        if status != 204:
            self.send_header("Content-Type", mime + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
        for k,v in (headers or {}).items():
            self.send_header(k,v)
        self.end_headers()
        if self.command != "HEAD" and data:
            self.wfile.write(data)

    def fields(self, names, form=False):
        mime = "application/x-www-form-urlencoded" if form else "application/json"
        if self.headers.get_content_type() != mime:
            raise Error(415, "unsupported_media_type")
        if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
            raise Error(400, "invalid_request")
        length = self.headers.get("Content-Length", "")
        if not re.fullmatch(r"[0-9]{1,6}", length) or not 0 < int(length) <= 4096:
            raise Error(413, "invalid_length")
        try:
            raw = self.rfile.read(int(length)).decode()
            if form:
                pairs = parse_qs(raw, keep_blank_values=True, strict_parsing=True, max_num_fields=4)
                if any(len(items) != 1 for items in pairs.values()):
                    raise ValueError("duplicate field")
                values = {k: v[0] for k,v in pairs.items()}
            else:
                values = json.loads(raw, object_pairs_hook=unique_fields)
            if not isinstance(values,dict) or set(values) != set(names) or not all(isinstance(v,str) for v in values.values()):
                raise ValueError()
            return values
        except (ValueError, UnicodeError, RecursionError):
            raise Error(400, "invalid_request") from None

    def bearer(self):
        match = re.fullmatch(r"Bearer ((?:dir|own)_[A-Za-z0-9_-]{43})", self.headers.get("Authorization",""), re.IGNORECASE)
        if not match:
            raise Error(401, "invalid_token")
        return match[1]

    def dispatch(self):
        parts = urlsplit(self.path)
        if parts.scheme or parts.netloc or parts.fragment or (parts.query and parts.path != "/agent/directory"):
            raise Error(400, "invalid_request")
        path = parts.path
        routes = {"/agent/auth": ("POST",), "/agent/auth/claim": ("POST",), "/agent/auth/revoke": ("POST",),
                  "/agent/claim": ("GET","HEAD","POST"), "/agent/claim/revoke": ("POST",),
                  "/agent/directory": ("GET","HEAD")}
        if path not in routes:
            raise Error(404, "not_found")
        if self.command not in routes[path]:
            return self.send_result(405, {"error":"method_not_allowed"}, headers={"Allow": ", ".join(routes[path])})
        kind = "register" if path == "/agent/auth" else "directory" if path == "/agent/directory" else "claim"
        self.server.limits.allow(self.headers.get("X-Real-IP", self.client_address[0])[:64], kind)
        store = self.server.store
        if path == "/agent/auth":
            data = self.fields(["type","requested_credential_type"])
            if data != {"type":"anonymous","requested_credential_type":"api_key"}:
                raise Error(400, "unsupported_registration")
            return self.send_result(200, store.register())
        if path == "/agent/auth/claim":
            return self.send_result(200, store.initiate_claim(self.fields(["claim_token"])["claim_token"]))
        if path == "/agent/auth/revoke":
            store.revoke(self.bearer())
            return self.send_result(204)
        if path == "/agent/directory":
            store.authorize(self.bearer())
            args = parse_qs(parts.query, keep_blank_values=True, strict_parsing=True, max_num_fields=1)
            query = args.get("query", [""])[0]
            if any(k != "query" for k in args) or len(query) > 160:
                raise Error(400,"invalid_query")
            return self.send_result(200, self.server.search(query))
        if self.command in ("GET","HEAD"):
            return self.send_result(200, human_page(FORM), "text/html")
        if self.headers.get_all("Origin") != [ORIGIN]:
            raise Error(403,"cross_origin_form")
        key = "owner_token" if path.endswith("/revoke") else "code"
        data = self.fields([key,"confirm"], form=True)
        if data["confirm"] != "yes":
            raise Error(400, "confirmation_required")
        if key == "code":
            owner = store.claim(data[key])
            message = '<h1>领取成功</h1><p>请保存这把撤销密钥；此页只显示一次。</p><code>' + html.escape(owner) + '</code>'
        else:
            if not re.fullmatch(r"own_[A-Za-z0-9_-]{43}", data[key]):
                raise Error(400, "invalid_owner_token")
            store.revoke(data[key])
            message = '<h1>已受理撤销</h1><p>与这把密钥对应的目录凭证已失效。</p>'
        self.send_result(200, human_page(message), "text/html")

    def handle_request(self):
        try:
            self.dispatch()
        except Error as e:
            headers = {}
            if e.status == 401:
                headers["WWW-Authenticate"] = 'Bearer resource_metadata="' + RESOURCE + '"'
            if e.status in (429,503):
                headers["Retry-After"] = "60"
            self.send_result(e.status, {"error":e.code}, headers=headers)
        except ValueError:
            self.send_result(400, {"error":"invalid_request"})
        except sqlite3.Error:
            self.send_result(503, {"error":"registration_unavailable"}, headers={"Retry-After":"5"})

    do_GET = do_HEAD = do_POST = handle_request


class Server(ThreadingHTTPServer):
    def __init__(self, address, store, search=search_directory):
        self.store = store
        self.search = search
        self.limits = RateLimits()
        self.last_cleanup = 0
        super().__init__(address, Handler)

    def service_actions(self):
        if time.monotonic() - self.last_cleanup >= 60:
            self.last_cleanup = time.monotonic()
            try:
                with self.store.connect() as db:
                    self.store.prune(db, int(time.time()))
            except sqlite3.Error:
                print("Directory registration cleanup deferred.", flush=True)


if __name__ == "__main__":
    os.umask(0o077)
    with Server(("127.0.0.1",18747), Store(os.environ["AGENT_REG_DB"])) as server:
        server.serve_forever()
