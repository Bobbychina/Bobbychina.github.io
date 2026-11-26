import concurrent.futures
import http.client
import json
import re
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from urllib.parse import urlencode

import server


class Registration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = server.Store(str(Path(self.temp.name) / "registrations.sqlite"))
        self.app = server.Server(("127.0.0.1", 0), self.store, lambda q: {"entries": [{"title": q, "url": server.ORIGIN}]})
        self.addCleanup(self.app.server_close)
        threading.Thread(target=self.app.serve_forever, daemon=True).start()
        self.addCleanup(self.app.shutdown)

    def request(self, method, path, data=None, token=None, form=False, origin=server.ORIGIN):
        headers = {}
        body = None
        if data is not None:
            body = urlencode(data) if form else json.dumps(data)
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        if origin:
            headers["Origin"] = origin
        if token:
            headers["Authorization"] = "Bearer " + token
        with closing(http.client.HTTPConnection(*self.app.server_address, timeout=3)) as conn:
            conn.request(method, path, body, headers)
            response = conn.getresponse()
            raw = response.read().decode()
            self.assertEqual(response.getheader("Cache-Control"), "no-store")
            form_page = path == "/agent/claim" and method in ("GET", "HEAD") and response.status == 200
            self.assertEqual(response.getheader("Referrer-Policy"), "same-origin" if form_page else "no-referrer")
            return response.status, json.loads(raw) if raw and response.getheader("Content-Type","").startswith("application/json") else raw

    def register(self):
        status, reg = self.request("POST", "/agent/auth", {"type":"anonymous","requested_credential_type":"api_key"})
        self.assertEqual(status, 200)
        self.assertEqual(reg["scopes"], ["directory.read"])
        return reg

    def test_claim_handoff_and_revocation(self):
        self.assertEqual(self.request("GET", "/agent/claim")[0], 200)
        reg = self.register()
        access, claim = reg["credential"], reg["claim_token"]
        query = "/agent/directory?" + urlencode({"query": "测试"})
        self.assertEqual(self.request("GET", query, token=access)[1]["entries"][0]["title"], "测试")
        self.assertEqual(self.request("GET", query, token=claim)[0], 401)
        self.assertEqual(self.request("POST", "/agent/auth/claim", {"claim_token": access})[0], 400)
        status, attempt = self.request("POST", "/agent/auth/claim", {"claim_token": claim})
        self.assertEqual(status, 200)
        self.assertEqual(attempt["verification_uri"], server.ORIGIN + "/agent/claim")
        code = attempt["user_code"]
        form = {"code": code, "confirm": "yes"}
        self.assertEqual(self.request("GET", "/agent/claim")[0], 200)
        self.assertEqual(self.request("POST", "/agent/claim", form, form=True, origin="https://other.test")[0], 403)
        self.assertEqual(self.request("POST", "/agent/claim", form, form=True, origin=None)[0], 403)
        self.assertEqual(self.request("POST", "/agent/claim", {"code":code}, form=True)[0], 400)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            replies = list(pool.map(lambda _: self.request("POST", "/agent/claim", form, form=True), range(2)))
        self.assertEqual(sorted(r[0] for r in replies), [200,400])
        html = next(v for s,v in replies if s == 200)
        owner = re.search(r"<code>(own_[A-Za-z0-9_-]+)</code>", html)[1]
        self.assertEqual(self.request("GET", query, token=owner)[0], 401)
        self.assertEqual(self.request("POST", "/agent/auth/claim", {"claim_token":claim})[0], 400)
        with self.store.connect() as db:
            row = db.execute("SELECT credential,claim_token,user_code,owner_token FROM registrations").fetchone()
            self.assertEqual(row,(server.digest(access),None,None,server.digest(owner)))
        self.assertEqual(self.request("POST","/agent/claim/revoke", {"owner_token":owner,"confirm":"yes"},form=True)[0],200)
        self.assertEqual(self.request("GET", query, token=access)[0], 401)

    def test_expiry_and_limits(self):
        reg = self.register()
        with self.store.connect() as db:
            db.execute("UPDATE registrations SET claim_expires=0")
        self.assertEqual(self.request("POST","/agent/auth/claim", {"claim_token":reg["claim_token"]})[0],400)
        with self.store.connect() as db:
            db.execute("UPDATE registrations SET expires=0")
        self.assertEqual(self.request("GET","/agent/directory",token=reg["credential"])[0],401)
        new = self.register()
        self.assertEqual(self.request("POST","/agent/auth/revoke",token=new["credential"])[0],204)
        self.assertEqual(self.request("GET","/agent/directory",token=new["credential"])[0],401)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM registrations").fetchone()[0], 0)
        limiter = server.RateLimits()
        for _ in range(limiter.limits["register"][0]):
            limiter.allow("client", "register")
        with self.assertRaises(server.Error) as error:
            limiter.allow("client", "register")
        self.assertEqual(error.exception.status, 429)

    def test_refuses_other_fields_and_wrong_grants(self):
        for data in ({"type":"anonymous","email":"X","requested_credential_type":"api_key"},
                     {"type":"user","requested_credential_type":"api_key"}):
            self.assertEqual(self.request("POST","/agent/auth",data)[0],400)
        self.assertEqual(self.request("POST","/agent/auth?query=x")[0],400)
        self.assertEqual(self.request("GET","/agent/auth")[0],405)
        self.assertEqual(self.request("GET","/api/auth/identity/oauth/userinfo")[0],404)


if __name__ == "__main__":
    unittest.main()
