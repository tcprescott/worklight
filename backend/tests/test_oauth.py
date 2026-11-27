import base64
import hashlib
import json
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

from tests.client import DIRECTOR, Client
from tests.fakes import FakeMailer
from tests.test_linenotes import _chars, _set
from tests.test_public_api import _as
from tests.test_schedule import _show

REDIRECT = "https://claude.ai/api/mcp/auth_callback"
VERIFIER = "a-long-random-verifier-string-for-pkce-0123456789"
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")
FORM = {"content-type": "application/x-www-form-urlencoded"}


def _register(call: Client) -> str:
    status, client = call(
        None, "POST", "/oauth/register", {"client_name": "Claude", "redirect_uris": [REDIRECT]}
    )
    assert status == 201, client
    return str(client["client_id"])


def _request(client_id: str, **extra: Any) -> dict[str, Any]:
    return {
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        "state": "xyz",
        "resource": "https://worklight.test/mcp",
        **extra,
    }


def _token(call: Client, **form: str) -> tuple[int, Any]:
    return call(None, "POST", "/oauth/token", raw_body=urlencode(form), headers=FORM)


def _sign_in(call: Client, email: str) -> dict[str, Any]:
    """Runs the whole flow as an app would, with the person allowing it on /connect."""
    client_id = _register(call)
    info = call.ok(email, "POST", "/api/oauth/connect-info", _request(client_id))
    assert info == {"clientName": "Claude", "redirectHost": "claude.ai"}
    back = call.ok(email, "POST", "/api/oauth/authorize", {**_request(client_id), "approve": True})
    url = urlsplit(back["redirectTo"])
    params = parse_qs(url.query)
    assert url.netloc == "claude.ai" and params["state"] == ["xyz"]
    assert params["iss"] == ["https://worklight.test"]
    code = params["code"][0]
    status, tokens = _token(
        call,
        grant_type="authorization_code",
        code=code,
        code_verifier=VERIFIER,
        client_id=client_id,
        redirect_uri=REDIRECT,
    )
    assert status == 200, tokens
    # Each code works once.
    again = _token(
        call,
        grant_type="authorization_code",
        code=code,
        code_verifier=VERIFIER,
        client_id=client_id,
        redirect_uri=REDIRECT,
    )
    assert again[0] == 400 and again[1]["error"] == "invalid_grant"
    return {**tokens, "client_id": client_id}


def _tool(call: Client, token: str, name: str, **arguments: Any) -> Any:
    status, body = call(
        None,
        "POST",
        "/mcp",
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        headers=_as(token),
    )
    assert status == 200, body
    return body["result"]


def test_discovery_and_challenge(call: Client) -> None:
    status, body = call(None, "POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert status == 401
    res = call.handler(
        {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": "/mcp",
            "rawQueryString": "",
            "headers": {"content-type": "application/json", "host": "worklight.test"},
            "requestContext": {
                "http": {"method": "POST", "path": "/mcp", "protocol": "HTTP/1.1", "sourceIp": "203.0.113.1"},
                "stage": "$default",
            },
            "body": "{}",
            "isBase64Encoded": False,
        },
        None,
    )
    assert (
        'resource_metadata="https://worklight.test/.well-known/oauth-protected-resource"'
        in (res["headers"]["www-authenticate"])
    )
    resource = call.ok("x@example.org", "GET", "/.well-known/oauth-protected-resource")
    assert resource["resource"] == "https://worklight.test/mcp"
    server = call.ok(
        "x@example.org",
        "GET",
        resource["authorization_servers"][0].removeprefix("https://worklight.test")
        + "/.well-known/oauth-authorization-server",
    )
    assert server["authorization_endpoint"] == "https://worklight.test/connect"
    assert server["code_challenge_methods_supported"] == ["S256"]

    # Only https redirects (or localhost) can register.
    status, err = call(
        None, "POST", "/oauth/register", {"client_name": "Evil", "redirect_uris": ["http://evil.test/cb"]}
    )
    assert status == 400 and err["error"] == "invalid_redirect_uri"


def test_connect_checks_the_request(call: Client) -> None:
    client_id = _register(call)
    # A redirect the app didn't register is shown on the page, never followed.
    status, err = call(
        "maya@example.org",
        "POST",
        "/api/oauth/connect-info",
        _request(client_id, redirect_uri="https://evil.test/cb"),
    )
    assert status == 400 and "doesn't match" in err["error"]
    # Without PKCE the app gets an error back; saying no sends access_denied.
    no_pkce = call.ok(
        "maya@example.org",
        "POST",
        "/api/oauth/authorize",
        {**_request(client_id, code_challenge=""), "approve": True},
    )
    assert "error=invalid_request" in no_pkce["redirectTo"]
    denied = call.ok(
        "maya@example.org", "POST", "/api/oauth/authorize", {**_request(client_id), "approve": False}
    )
    assert "error=access_denied" in denied["redirectTo"] and "state=xyz" in denied["redirectTo"]
    # A wrong verifier gets nothing.
    back = call.ok(
        "maya@example.org", "POST", "/api/oauth/authorize", {**_request(client_id), "approve": True}
    )
    code = parse_qs(urlsplit(back["redirectTo"]).query)["code"][0]
    status, err = _token(
        call,
        grant_type="authorization_code",
        code=code,
        code_verifier="wrong-verifier-wrong-verifier-wrong-verifier",
        client_id=client_id,
        redirect_uri=REDIRECT,
    )
    assert status == 400 and err["error"] == "invalid_grant"


def test_actor_signs_in_and_reads_only_their_notes(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    base = show["base"]
    set_id = _set(call, show)
    call.ok(
        DIRECTOR,
        "POST",
        f"{base}/notes/{set_id}/notes",
        {"notes": [{"actorId": show["maya"], "kind": "dropped"}, {"actorId": show["jay"], "kind": "late"}]},
    )
    call.ok(DIRECTOR, "POST", f"{base}/notes/{set_id}/release")

    tokens = _sign_in(call, "maya@example.org")
    access = tokens["access_token"]
    mine = json.loads(_tool(call, access, "my_line_notes", show_id=show["id"])["content"][0]["text"])
    assert [[n["actorId"] for n in s["notes"]] for s in mine] == [[show["maya"]]]
    # Maya is cast: she can't file notes, and sees only her own in the set.
    assert _tool(
        call,
        access,
        "add_line_notes",
        show_id=show["id"],
        set_id=set_id,
        notes=[{"actorId": show["jay"], "kind": "late"}],
    )["isError"]
    detail = json.loads(
        _tool(call, access, "get_line_notes", show_id=show["id"], set_id=set_id)["content"][0]["text"]
    )
    assert {n["actorId"] for n in detail["notes"]} == {show["maya"]}

    # The connection shows up in Account, and refreshing rotates the refresh token.
    connections = call.ok("maya@example.org", "GET", "/api/me/connections")
    assert [(k["kind"], k["name"]) for k in connections] == [("connection", "Claude")]
    status, fresh = _token(
        call, grant_type="refresh_token", refresh_token=tokens["refresh_token"], client_id=tokens["client_id"]
    )
    assert status == 200 and fresh["refresh_token"] != tokens["refresh_token"]
    reused = _token(call, grant_type="refresh_token", refresh_token=tokens["refresh_token"])
    assert reused[0] == 400
    # A refresh token is not an access token.
    assert (
        call(None, "GET", f"/api/v1/shows/{show['id']}/notes", headers=_as(fresh["refresh_token"]))[0] == 401
    )

    # Disconnecting ends every token at once.
    call.ok("maya@example.org", "DELETE", f"/api/me/connections/{connections[0]['keyId']}")
    tools_list = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    assert call(None, "POST", "/mcp", tools_list, headers=_as(fresh["access_token"]))[0] == 401
    assert _token(call, grant_type="refresh_token", refresh_token=fresh["refresh_token"])[0] == 400


def test_director_signs_in_and_files_notes(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    chars = _chars(call, show)
    access = _sign_in(call, DIRECTOR)["access_token"]
    filed = _tool(
        call,
        access,
        "add_line_notes",
        show_id=show["id"],
        date="2026-11-25",
        title="Run of Act I",
        notes=[{"charId": chars["Bottom"], "kind": "dropped", "page": "12"}],
    )
    assert not filed.get("isError"), filed
    set_id = json.loads(filed["content"][0]["text"])["setId"]
    released = _tool(call, access, "release_line_notes", show_id=show["id"], set_id=set_id)
    assert json.loads(released["content"][0]["text"])["actorCount"] == 1
    # A person's sign-in only reaches their own shows.
    other = call.ok("other@example.org", "POST", "/api/theaters", {"name": "Elsewhere"})["theaterId"]
    assert call(None, "GET", f"/api/v1/theaters/{other}", headers=_as(access))[0] == 404
