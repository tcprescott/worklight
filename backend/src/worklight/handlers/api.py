"""Lambda entry point for the HTTP API."""

from typing import Any

from mangum import Mangum

from worklight.app import AppDeps, create_app
from worklight.config import get_app_url, require_env
from worklight.mailer import SesMailer
from worklight.store import DynamoStore

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
