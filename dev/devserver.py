"""Runs the API on your machine with no AWS account: moto's in-memory DynamoDB, an outbox instead of SES,
and a stand-in for Cognito sign-in. Data resets when it stops.

    uv run python dev/devserver.py            # API on http://localhost:8787, seeded with the sample show
    cd web && npm run dev:local               # web app on http://localhost:5173 using it

Sign in as anyone in the sample data (jordan@example.org directs, maya@example.org plays Hermia). Sign-in
links and every other email land in the outbox at http://localhost:8787/api/dev/outbox.
"""

import argparse
import base64
import json
import os
import sys
from dataclasses import asdict
from datetime import date
from pathlib import Path
from typing import Any

import boto3
import uvicorn
from fastapi import FastAPI, HTTPException
from moto import mock_aws
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed import seed  # noqa: E402

from worklight import clock  # noqa: E402
from worklight.app import create_app  # noqa: E402
from worklight.keys import normalize_email  # noqa: E402
from worklight.localdb import create_table  # noqa: E402
from worklight.mailer import Email  # noqa: E402
from worklight.services.base import Ctx  # noqa: E402
from worklight.services.shows import invite_sign_in_ok  # noqa: E402
from worklight.store import DynamoStore  # noqa: E402


class Outbox:
    def __init__(self) -> None:
        self.sent: list[Email] = []

    def send(self, email: Email) -> None:
        self.sent.append(email)
        print(f"\n[email to {email.to}] {email.subject}\n{email.text}\n", flush=True)


class DevAuth:
    """ASGI middleware: turns "Authorization: Bearer dev.<base64 email>" into the JWT claims API Gateway
    would pass, so the app's real sign-in check runs unchanged."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            auth = headers.get(b"authorization", b"").decode()
            claims: dict[str, str] = {}
            if auth.startswith("Bearer dev."):
                email = base64.urlsafe_b64decode(auth.removeprefix("Bearer dev.") + "==").decode()
                claims = {"email": normalize_email(email), "email_verified": "true"}
            scope["aws.event"] = {"requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
        await self.app(scope, receive, send)


class EmailBody(BaseModel):
    email: str
    next: str = "/"


class TokenBody(BaseModel):
    token: str


def build(seeded: bool, app_url: str) -> Any:
    client = boto3.client("dynamodb", region_name="us-east-1")
    create_table(client)
    outbox = Outbox()
    ctx = Ctx(store=DynamoStore("worklight", client), mailer=outbox, app_url=app_url)
    if seeded:
        seed(ctx)
    app: FastAPI = create_app(ctx)

    @app.get("/api/dev/outbox")
    def get_outbox() -> list[dict[str, str]]:
        return [asdict(e) for e in reversed(outbox.sent)]

    @app.post("/api/dev/magic-link")
    def magic_link(body: EmailBody) -> dict[str, str]:
        """Stands in for Cognito's custom auth: "emails" a link that signs in as this address."""
        email = normalize_email(body.email)
        url = f"{app_url}/auth/magic?email={email}&code=dev&next={body.next}"
        outbox.send(
            Email(to=email, subject="Your Worklight sign-in link", text=f"Sign in:\n\n{url}", html=url)
        )
        return {"step": "email-sent"}

    @app.post("/api/dev/invite-sign-in")
    def invite_sign_in(body: TokenBody) -> dict[str, str]:
        invite = ctx.store.get_invite(body.token)
        if not invite or not invite_sign_in_ok(ctx.store, invite.email, body.token):
            raise HTTPException(404, "This invite has expired or was already used")
        return {"email": invite.email}

    return DevAuth(app)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--empty", action="store_true", help="start with no sample data")
    parser.add_argument("--today", help="pretend it's this date (YYYY-MM-DD), e.g. to see a rehearsal week")
    parser.add_argument(
        "--app-url", default="http://localhost:5173", help="the web app's URL, for emailed links"
    )
    args = parser.parse_args()
    if args.today:
        pinned = date.fromisoformat(args.today)
        clock.today = lambda: pinned  # type: ignore[assignment]
    for key, value in {
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "dev",
        "AWS_SECRET_ACCESS_KEY": "dev",
    }.items():
        os.environ.setdefault(key, value)
    with mock_aws():
        app = build(not args.empty, args.app_url.rstrip("/"))
        print(
            json.dumps(
                {
                    "api": f"http://localhost:{args.port}",
                    "outbox": f"http://localhost:{args.port}/api/dev/outbox",
                }
            )
        )
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
