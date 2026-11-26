"""Check public discovery. --exercise issues and revokes one temporary directory key."""

import argparse
from datetime import datetime
from email.utils import parsedate_to_datetime
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = "https://bobbycn.cc"
RESOURCE = "/agent/directory"
PRM = "/.well-known/oauth-protected-resource/agent/directory"
AS = "/.well-known/oauth-authorization-server"


class CheckFailed(Exception):
    pass


def check(condition, description):
    if not condition:
        raise CheckFailed(description)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# Use explicit first-party endpoints; do not forward a credential on redirects.
client = build_opener(NoRedirect())
client.addheaders = [("User-Agent", "Bobbycn-Public-Directory-Verification/1.0 (+https://bobbycn.cc/auth.md)")]


def request(path, status, *, payload=None, method="GET", key=None, markdown=False):
    headers = {"Accept": "text/markdown" if markdown else "application/json, application/linkset+json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode()
    req = Request(BASE + path, method=method, data=body, headers=headers)
    try:
        response = client.open(req, timeout=15)
    except HTTPError as exc:
        response = exc
    with response:
        check(response.status == status, f"{method} {path} returned {response.status}, expected {status}")
        if status != 200:
            return None, response.headers
        raw = response.read()
        if markdown:
            check(response.headers.get_content_type() == "text/markdown", f"{path} is not Markdown")
            return raw.decode("utf-8"), response.headers
        check(response.headers.get_content_type() in ("application/json", "application/linkset+json"),
              f"{path} is not a JSON response")
        return json.loads(raw), response.headers


def discovery():
    doc, _ = request("/auth.md", 200, markdown=True)
    for marker in ("auth.md", "anonymous", "/agent/auth", "/agent/auth/claim", "/agent/auth/revoke", "directory.read"):
        check(marker in doc, f"Missing documentation for {marker}")
    rm, _ = request(PRM, 200)
    check(rm.get("resource") == BASE + RESOURCE and rm.get("authorization_servers") == [BASE]
          and rm.get("scopes_supported") == ["directory.read"] and "header" in rm.get("bearer_methods_supported", []),
          "Directory resource metadata mismatch")
    metadata, _ = request(AS, 200)
    agent = metadata.get("agent_auth", {})
    check(metadata.get("issuer") == BASE and agent.get("register_uri") == BASE + "/agent/auth"
          and agent.get("claim_uri") == BASE + "/agent/auth/claim" and agent.get("skill") == BASE + "/auth.md"
          and agent.get("identity_types_supported") == ["anonymous"]
          and agent.get("anonymous", {}).get("credential_types_supported") == ["api_key"],
          "Directory registration metadata mismatch")
    check(metadata.get("token_endpoint") == BASE + "/api/auth/identity/oauth/token"
          and "authorization_code" in metadata.get("grant_types_supported", [])
          and "directory.read" not in metadata.get("scopes_supported", []), "Site OAuth metadata mismatch")
    catalog, _ = request("/.well-known/api-catalog", 200)
    check(any(row.get("anchor") == rm["resource"]
              and any(link.get("href") == BASE + PRM for link in row.get("service-meta", []))
              for row in catalog.get("linkset", [])), "Directory metadata absent from API catalog")
    _, headers = request(RESOURCE, 401)
    check('resource_metadata="' + BASE + PRM + '"' in headers.get("WWW-Authenticate", ""),
          "Directory 401 missing resource_metadata challenge")
    print("PASS directory discovery, user OAuth separation, API catalog and unauthenticated challenge")


def exercise():
    registered, headers = request("/agent/auth", 200, method="POST",
                                  payload={"type": "anonymous", "requested_credential_type": "api_key"})
    key = registered.get("credential")
    check(isinstance(key, str) and key, "Registration omitted the issued credential")
    try:
        check("no-store" in headers.get("Cache-Control", "").lower(), "Credential response is cacheable")
        check(registered.get("registration_type") == "anonymous" and registered.get("credential_type") == "api_key"
              and registered.get("scopes") == ["directory.read"] and registered.get("credential_expires")
              and registered.get("claim_token") and registered.get("claim_url") == BASE + "/agent/auth/claim",
              "Registration fields mismatch")
        expiry = datetime.fromisoformat(registered["credential_expires"].replace("Z", "+00:00"))
        lifetime = (expiry - parsedate_to_datetime(headers["Date"])).total_seconds()
        check(3300 <= lifetime <= 3900, "Unexpected directory credential lifetime")
        entries, _ = request(RESOURCE + "?query=Minecraft", 200, key=key)
        check(any(entry.get("url") == BASE + "/games/#blockline" for entry in entries.get("entries", [])),
              "Directory lookup did not return the Minecraft preview")
        claim, headers = request("/agent/auth/claim", 200, method="POST", payload={"claim_token": registered["claim_token"]})
        check(claim.get("registration_id") == registered.get("registration_id") and claim.get("status") == "initiated"
              and claim.get("user_code") and claim.get("verification_uri") == BASE + "/agent/claim"
              and "no-store" in headers.get("Cache-Control", "").lower(), "Claim initiation mismatch")
    finally:
        request("/agent/auth/revoke", 204, method="POST", key=key)
    request(RESOURCE, 401, key=key)
    print("PASS one-hour directory key issued, lookup succeeded, human claim initiated, key revoked and rejected")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exercise", action="store_true", help="perform a live registration; revoke it during cleanup")
    args = parser.parse_args()
    discovery()
    if args.exercise:
        exercise()


if __name__ == "__main__":
    try:
        main()
    except (CheckFailed, URLError, TimeoutError, ValueError) as exc:
        print("FAIL:", exc, file=sys.stderr)
        sys.exit(1)
