import json
from typing import Any

import pytest
from mangum import Mangum

from tests.fakes import FakeMailer, MemoryStore
from worklight.app import AppDeps, create_app


class Client:
    """Calls the app the way API Gateway does: an HTTP API v2 event with the verified JWT claims."""

    def __init__(self, store: MemoryStore, mailer: FakeMailer) -> None:
        self.handler = Mangum(
            create_app(AppDeps(store=store, mailer=mailer, app_url="https://worklight.test")), lifespan="off"
        )

    def __call__(
        self,
        email: str | None,
        method: str,
        path: str,
        body: Any = None,
        *,
        verified: bool = True,
        raw_body: str | None = None,
    ) -> tuple[int, Any]:
        claims = {"email": email, "email_verified": "true" if verified else "false"} if email else {}
        event = {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": path,
            "rawQueryString": "",
            "headers": {"content-type": "application/json", "host": "worklight.test"},
            "requestContext": {
                "http": {
                    "method": method,
                    "path": path,
                    "protocol": "HTTP/1.1",
                    "sourceIp": "203.0.113.1",
                    "userAgent": "pytest",
                },
                "authorizer": {"jwt": {"claims": claims, "scopes": []}},
                "domainName": "worklight.test",
                "stage": "$default",
            },
            "body": raw_body if raw_body is not None else (None if body is None else json.dumps(body)),
            "isBase64Encoded": False,
        }
        res = self.handler(event, None)
        return res["statusCode"], json.loads(res["body"]) if res.get("body") else None


@pytest.fixture
def call(store: MemoryStore, mailer: FakeMailer) -> Client:
    return Client(store, mailer)


def set_up_show(call: Client, director: str = "director@example.org") -> tuple[str, str]:
    _, theater = call(director, "POST", "/api/theaters", {"name": "Riverside Players"})
    status, show = call(
        director,
        "POST",
        f"/api/theaters/{theater['theaterId']}/shows",
        {
            "name": "Our Town",
            "timezone": "America/Chicago",
            "startDate": "2026-11-02",
            "endDate": "2027-01-17",
        },
    )
    assert status == 201, show
    return theater["theaterId"], show["showId"]


def invite_token(
    call: Client, mailer: FakeMailer, show_id: str, sender: str, email: str, role: str = "cast"
) -> str:
    status, body = call(sender, "POST", f"/api/shows/{show_id}/invites", {"email": email, "role": role})
    assert status == 201, body
    return mailer.last_link().split("/invite/")[1]


class TestIdentity:
    def test_rejects_requests_without_a_verified_email(self, call: Client) -> None:
        assert call(None, "GET", "/api/me")[0] == 401
        assert call("a@example.org", "GET", "/api/me", verified=False)[0] == 401

    def test_maps_every_sign_in_method_for_one_email_to_the_same_user(
        self, call: Client, store: MemoryStore
    ) -> None:
        _, first = call("Sam@Example.org", "GET", "/api/me")
        _, second = call("sam@example.org", "GET", "/api/me")
        assert first["user"]["userId"] == second["user"]["userId"]
        assert len(store.users) == 1

    def test_saves_a_display_name(self, call: Client) -> None:
        call("sam@example.org", "PATCH", "/api/me", {"name": "Sam Rivera"})
        assert call("sam@example.org", "GET", "/api/me")[1]["user"]["name"] == "Sam Rivera"


class TestTheatersAndShows:
    def test_makes_the_creator_a_theater_admin_and_the_shows_director(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        _, me = call("director@example.org", "GET", "/api/me")
        assert len(me["theaters"]) == 1
        assert me["shows"][0]["role"] == "staff"
        assert me["shows"][0]["title"] == "Director"
        assert me["shows"][0]["show"]["showId"] == show_id

    def test_only_lets_theater_admins_create_shows(self, call: Client) -> None:
        theater_id, _ = set_up_show(call)
        status, _ = call(
            "stranger@example.org",
            "POST",
            f"/api/theaters/{theater_id}/shows",
            {
                "name": "Hamlet",
                "timezone": "America/Chicago",
                "startDate": "2026-11-02",
                "endDate": "2026-12-01",
            },
        )
        assert status == 403

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            ({"timezone": "Mars/Olympus"}, "timezone must be an IANA timezone like America/Chicago"),
            ({"startDate": "11/02/2026"}, "startDate must be a date like 2026-11-02"),
            ({"endDate": "2026-10-01"}, "endDate must be on or after startDate"),
            ({"name": "  "}, "name is required"),
        ],
    )
    def test_validates_show_input(self, call: Client, change: dict[str, str], message: str) -> None:
        _, theater = call("d@example.org", "POST", "/api/theaters", {"name": "T"})
        base = {
            "name": "S",
            "timezone": "America/Chicago",
            "startDate": "2026-11-02",
            "endDate": "2026-12-01",
        }
        status, body = call(
            "d@example.org", "POST", f"/api/theaters/{theater['theaterId']}/shows", base | change
        )
        assert (status, body) == (400, {"error": message})

    def test_hides_a_show_from_people_who_arent_in_it(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        assert call("stranger@example.org", "GET", f"/api/shows/{show_id}")[0] == 403
        assert call("stranger@example.org", "GET", "/api/shows/nope")[0] == 404

    def test_leaves_out_empty_fields(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        _, body = call("director@example.org", "GET", f"/api/shows/{show_id}")
        assert "venue" not in body["show"]


class TestInvites:
    def test_emails_a_link_that_adds_the_invitee_to_the_show(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        token = invite_token(call, mailer, show_id, "director@example.org", "Actor@Example.org")
        assert mailer.sent[-1].to == "actor@example.org"

        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept") == (
            200,
            {"showId": show_id, "role": "cast"},
        )
        assert call("actor@example.org", "GET", f"/api/shows/{show_id}")[1]["role"] == "cast"

    def test_can_only_be_accepted_once_by_the_invited_address(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        token = invite_token(call, mailer, show_id, "director@example.org", "actor@example.org")
        assert call("someone-else@example.org", "POST", f"/api/invites/{token}/accept")[0] == 403
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 200
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 404

    def test_rejects_expired_invites(self, call: Client, mailer: FakeMailer, store: MemoryStore) -> None:
        _, show_id = set_up_show(call)
        token = invite_token(call, mailer, show_id, "director@example.org", "actor@example.org")
        store.invites[token] = store.invites[token].model_copy(update={"expires_at": 1})
        assert call("actor@example.org", "POST", f"/api/invites/{token}/accept")[0] == 404

    def test_doesnt_let_cast_invite_people_or_see_email_addresses(
        self, call: Client, mailer: FakeMailer
    ) -> None:
        _, show_id = set_up_show(call)
        token = invite_token(call, mailer, show_id, "director@example.org", "actor@example.org")
        call("actor@example.org", "POST", f"/api/invites/{token}/accept")

        assert (
            call("actor@example.org", "POST", f"/api/shows/{show_id}/invites", {"email": "x@example.org"})[0]
            == 403
        )

        _, as_cast = call("actor@example.org", "GET", f"/api/shows/{show_id}/members")
        assert all("email" not in m for m in as_cast)
        _, as_staff = call("director@example.org", "GET", f"/api/shows/{show_id}/members")
        assert sorted(m["email"] for m in as_staff) == ["actor@example.org", "director@example.org"]

    def test_never_downgrades_staff_who_accept_a_cast_invite(self, call: Client, mailer: FakeMailer) -> None:
        _, show_id = set_up_show(call)
        token = invite_token(call, mailer, show_id, "director@example.org", "director@example.org", "cast")
        assert call("director@example.org", "POST", f"/api/invites/{token}/accept")[1]["role"] == "staff"

    def test_validates_invite_input(self, call: Client) -> None:
        _, show_id = set_up_show(call)
        path = f"/api/shows/{show_id}/invites"
        assert call("director@example.org", "POST", path, {"email": "nope"}) == (
            400,
            {"error": "email must be a valid email address"},
        )
        assert call("director@example.org", "POST", path, {"email": "a@b.org", "role": "admin"}) == (
            400,
            {"error": "role must be staff, cast or crew"},
        )


class TestRouting:
    def test_returns_404_and_405_for_unknown_routes_and_methods(self, call: Client) -> None:
        assert call("a@example.org", "GET", "/api/nothing") == (404, {"error": "Not found"})
        assert call("a@example.org", "DELETE", "/api/me") == (405, {"error": "Method not allowed"})

    def test_rejects_bodies_that_arent_json_objects(self, call: Client) -> None:
        assert call("a@example.org", "POST", "/api/theaters", raw_body="not json") == (
            400,
            {"error": "Request body must be a JSON object"},
        )
        assert call("a@example.org", "POST", "/api/theaters", raw_body="[1]")[0] == 400

    def test_responses_are_never_cached(self, call: Client) -> None:
        res = call.handler(
            {
                "version": "2.0",
                "rawPath": "/api/me",
                "rawQueryString": "",
                "headers": {},
                "requestContext": {"http": {"method": "GET", "path": "/api/me", "sourceIp": "203.0.113.1"}},
                "isBase64Encoded": False,
            },
            None,
        )
        assert res["statusCode"] == 401
        assert res["headers"]["cache-control"] == "no-store"
