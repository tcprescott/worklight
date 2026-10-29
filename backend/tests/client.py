import json
from typing import Any

from mangum import Mangum

from tests.fakes import FakeMailer
from worklight.app import create_app
from worklight.services.base import Ctx
from worklight.store import DynamoStore


class Client:
    """Calls the app the way API Gateway does: an HTTP API v2 event with the verified JWT claims."""

    def __init__(self, store: DynamoStore, mailer: FakeMailer) -> None:
        self.handler = Mangum(
            create_app(Ctx(store=store, mailer=mailer, app_url="https://worklight.test")), lifespan="off"
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
        headers: dict[str, str] | None = None,
    ) -> tuple[int, Any]:
        path, _, query = path.partition("?")
        claims = {"email": email, "email_verified": "true" if verified else "false"} if email else {}
        event = {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": path,
            "rawQueryString": query,
            "headers": {
                "content-type": "application/json",
                "accept": "application/json, text/event-stream",
                "host": "worklight.test",
                **(headers or {}),
            },
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
        if not res.get("body"):
            return res["statusCode"], None
        if "json" not in res["headers"].get("content-type", ""):
            return res["statusCode"], res["body"]
        return res["statusCode"], json.loads(res["body"])

    def ok(self, email: str, method: str, path: str, body: Any = None) -> Any:
        status, data = self(email, method, path, body)
        assert 200 <= status < 300, (status, data)
        return data


DIRECTOR = "director@example.org"


def set_up_show(call: Client, director: str = DIRECTOR, **settings: Any) -> tuple[str, str]:
    theater = call.ok(director, "POST", "/api/theaters", {"name": "Riverside Players"})
    show = call.ok(
        director,
        "POST",
        f"/api/theaters/{theater['theaterId']}/shows",
        {
            "name": "Our Town",
            "timezone": "America/Chicago",
            "startDate": "2026-11-02",
            "endDate": "2027-01-17",
            **settings,
        },
    )
    return theater["theaterId"], show["showId"]


def invite(
    call: Client,
    mailer: FakeMailer,
    show_id: str,
    email: str,
    role: str = "cast",
    sender: str = DIRECTOR,
    **extra: Any,
) -> tuple[str, str]:
    """Invites someone and returns (userId, invite token)."""
    sent = call.ok(sender, "POST", f"/api/shows/{show_id}/invites", {"email": email, "role": role, **extra})
    return sent["userId"], mailer.last_link().split("/join/")[1]


def join(call: Client, mailer: FakeMailer, show_id: str, email: str, role: str = "cast", **extra: Any) -> str:
    user_id, token = invite(call, mailer, show_id, email, role, **extra)
    call.ok(email, "POST", f"/api/invites/{token}/accept")
    return user_id
