"""Lambda entry point for the HTTP API."""

from typing import Any

from mangum import Mangum

from call_time.app import AppDeps, create_app
from call_time.config import get_app_url, require_env
from call_time.mailer import SesMailer
from call_time.store import DynamoStore

_handler: Mangum | None = None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    global _handler
    if _handler is None:
        deps = AppDeps(
            store=DynamoStore(require_env("TABLE_NAME")),
            mailer=SesMailer(require_env("FROM_EMAIL")),
            app_url=get_app_url(),
        )
        _handler = Mangum(create_app(deps), lifespan="off")
    return _handler(event, context)
