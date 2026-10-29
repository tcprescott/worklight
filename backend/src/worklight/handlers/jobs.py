"""Lambda entry point for scheduled jobs (EventBridge, hourly)."""

import logging
from typing import Any

from worklight.config import get_app_url, require_env
from worklight.mailer import SesMailer
from worklight.services.base import Ctx
from worklight.services.notify import send_reminders
from worklight.store import DynamoStore

log = logging.getLogger(__name__)


def reminders(event: dict[str, Any], context: Any) -> dict[str, int]:
    ctx = Ctx(
        store=DynamoStore(require_env("TABLE_NAME")),
        mailer=SesMailer(require_env("FROM_EMAIL")),
        app_url=get_app_url(),
    )
    sent = send_reminders(ctx)
    log.info("Sent %d call reminders", sent)
    return {"sent": sent}
