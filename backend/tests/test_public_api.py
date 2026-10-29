from typing import Any

from tests.client import DIRECTOR, Client
from tests.fakes import FakeMailer
from tests.test_schedule import _show


def _key(call: Client, show: dict[str, Any], scope: str = "read") -> str:
    theater = call.ok(DIRECTOR, "GET", f"/api/shows/{show['id']}")["show"]["theaterId"]
    made = call.ok(
        DIRECTOR, "POST", f"/api/theaters/{theater}/api-keys", {"name": "Board script", "scope": scope}
    )
    assert made["secret"].startswith("wl_") and "secretHash" not in made["key"]
    return str(made["secret"])


def _as(key: str) -> dict[str, str]:
    return {"authorization": f"Bearer {key}"}


def test_rest_v1_with_an_api_key(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    key = _key(call, show)
    v1 = f"/api/v1/shows/{show['id']}"
    status, breakdown = call(None, "GET", f"{v1}/breakdown", headers=_as(key))
    assert status == 200 and len(breakdown["scenes"]) == 2
    status, _ = call(None, "GET", f"{v1}/schedule?from=2026-11-09&to=2026-11-15", headers=_as(key))
    assert status == 200

    # Read keys can't write; personal routes and other companies are out of reach.
    status, err = call(
        None, "POST", f"{v1}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]}, headers=_as(key)
    )
    assert status == 403 and "only read" in err["error"]
    assert call(None, "GET", "/api/v1/me/calls", headers=_as(key))[0] == 403
    theater = call.ok(DIRECTOR, "GET", f"/api/shows/{show['id']}")["show"]["theaterId"]
    assert (
        call(
            None, "POST", f"/api/v1/theaters/{theater}/admins", {"email": "x@example.org"}, headers=_as(key)
        )[0]
        == 403
    )
    other = call.ok("dana@example.org", "POST", "/api/theaters", {"name": "Elsewhere"})
    assert call(None, "GET", f"/api/v1/theaters/{other['theaterId']}", headers=_as(key))[0] == 404
    assert call(None, "GET", f"{v1}/breakdown", headers=_as("wl_nope"))[0] == 401
    assert call(None, "GET", f"{v1}/breakdown")[0] == 401

    writer = _key(call, show, "write")
    status, made = call(
        None, "POST", f"{v1}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]}, headers=_as(writer)
    )
    assert status == 200 and made["date"] == "2026-11-09"

    # Revoking a key stops it at once; keys list without secrets.
    keys = call.ok(DIRECTOR, "GET", f"/api/theaters/{theater}/api-keys")
    assert {k["scope"] for k in keys} == {"read", "write"} and all("secretHash" not in k for k in keys)
    read_key = next(k for k in keys if k["scope"] == "read")
    assert read_key["lastUsedAt"]
    call.ok(DIRECTOR, "DELETE", f"/api/theaters/{theater}/api-keys/{read_key['keyId']}")
    assert call(None, "GET", f"{v1}/breakdown", headers=_as(key))[0] == 401
    # Only admins manage keys.
    assert call("maya@example.org", "GET", f"/api/theaters/{theater}/api-keys")[0] == 403


def test_graphql(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    key = _key(call, show, "write")
    call.ok("maya@example.org", "PUT", "/api/me/conflicts/dates/2026-11-09", {"level": "hard"})

    def gql(query: str, **variables: Any) -> Any:
        status, body = call(
            None, "POST", "/api/graphql", {"query": query, "variables": variables}, headers=_as(key)
        )
        assert status == 200, body
        return body

    data = gql(
        "{ theater { name shows { show { showId name rehearsalNights { weekday start } } castCount } } }"
    )
    summary = data["data"]["theater"]["shows"][0]
    assert summary["show"]["name"] == "Our Town" and summary["castCount"] == 3
    assert summary["show"]["rehearsalNights"][0] == {"weekday": 0, "start": "19:00"}

    added = gql(
        "mutation($s: ID!, $scene: String!) "
        '{ addSceneToNight(showId: $s, date: "2026-11-09", sceneId: $scene) }',
        s=show["id"],
        scene=show["s1"],
    )
    assert added["data"]["addSceneToNight"]
    days = gql(
        'query($s: ID!) { schedule(showId: $s, fromDate: "2026-11-09", toDate: "2026-11-09") '
        "{ date calls { start blocks { start end warnings { part kind } } } } }",
        s=show["id"],
    )["data"]["schedule"]
    assert days[0]["calls"][0]["blocks"][0]["warnings"] == [{"part": "Hermia", "kind": "hard"}]
    published = gql(
        "mutation($s: ID!) "
        '{ publish(showId: $s, fromDate: "2026-11-09", toDate: "2026-11-15") { published } }',
        s=show["id"],
    )
    assert published["data"]["publish"]["published"] == 1

    missing = gql('query { show(showId: "nope") { name } }')
    assert missing["errors"][0]["message"] == "Show not found"


def test_mcp(call: Client, mailer: FakeMailer) -> None:
    show = _show(call, mailer)
    key = _key(call, show)

    def rpc(method: str, params: dict[str, Any] | None = None) -> Any:
        status, body = call(
            None,
            "POST",
            "/mcp",
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            headers=_as(key),
        )
        assert status == 200, body
        return body

    init = rpc(
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
    )
    assert init["result"]["serverInfo"]["name"] == "Worklight"
    tools = {t["name"] for t in rpc("tools/list")["result"]["tools"]}
    assert {"list_shows", "get_schedule", "suggest_scenes", "publish_schedule"} <= tools
    listed = rpc("tools/call", {"name": "list_shows", "arguments": {}})
    assert "Our Town" in listed["result"]["content"][0]["text"]
    ranked = rpc(
        "tools/call", {"name": "suggest_scenes", "arguments": {"show_id": show["id"], "date": "2026-11-09"}}
    )
    assert show["s1"] in ranked["result"]["content"][0]["text"]
    denied = rpc(
        "tools/call",
        {
            "name": "add_scene_to_night",
            "arguments": {"show_id": show["id"], "date": "2026-11-09", "scene_id": show["s1"]},
        },
    )
    assert denied["result"]["isError"] is True and "only read" in denied["result"]["content"][0]["text"]
    assert call(None, "POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})[0] == 401


def test_keys_are_rate_limited(call: Client, mailer: FakeMailer, monkeypatch: Any) -> None:
    from worklight.services import apikeys

    show = _show(call, mailer)
    key = _key(call, show)
    monkeypatch.setattr(apikeys, "RATE_LIMIT", 2)
    statuses = [call(None, "GET", f"/api/v1/shows/{show['id']}", headers=_as(key))[0] for _ in range(3)]
    assert statuses == [200, 200, 429]
