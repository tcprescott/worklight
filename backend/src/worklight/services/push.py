"""Who gets told what, and how: one notice goes out by email and to each of the person's push devices.

The callers (reminders, schedule changes, callboard notices) build the email and the push once and hand both
to deliver(); the person's preferences and devices decide what actually goes out.
"""

import hashlib
import logging
from typing import Literal

from pydantic import Field

from worklight.ids import now_iso
from worklight.mailer import Email
from worklight.models import Model, PushDevice, PushDeviceView, User
from worklight.push import PushMessage
from worklight.services.base import Ctx, Invalid, NotFound, optional_text
from worklight.webpush import is_push_endpoint

log = logging.getLogger(__name__)

Topic = Literal["reminders", "changes", "notices"]

_EMAIL_PREF: dict[Topic, str] = {
    "reminders": "email_reminders",
    "changes": "change_emails",
    "notices": "notice_emails",
}
_PUSH_PREF: dict[Topic, str] = {
    "reminders": "push_reminders",
    "changes": "push_changes",
    "notices": "push_notices",
}

# Plenty for a person's phone, laptop and tablet; stops a script filling the table.
MAX_DEVICES = 10


def deliver(ctx: Ctx, person: User, topic: Topic, email: Email, push: PushMessage) -> bool:
    """Sends by each channel the person has on for this topic. True when anything went out."""
    reached = False
    if getattr(person.prefs, _EMAIL_PREF[topic]):
        ctx.mailer.send(email)
        reached = True
    if getattr(person.prefs, _PUSH_PREF[topic]) and ctx.push.enabled:
        reached = push_to(ctx, person.user_id, push) > 0 or reached
    return reached


def push_to(ctx: Ctx, user_id: str, message: PushMessage, device_id: str | None = None) -> int:
    """Pushes to the person's devices (or just one). Drops devices whose subscription has ended."""
    sent = 0
    for device in ctx.store.list_push_devices(user_id):
        if device_id and device.device_id != device_id:
            continue
        result = ctx.push.deliver(device, message)
        if result == "sent":
            sent += 1
            ctx.store.touch_push_device(user_id, device.device_id, now_iso())
        elif result == "gone":
            log.info("Dropping push device %s: the subscription has ended", device.device_id)
            ctx.store.delete_push_device(user_id, device.device_id)
    return sent


# ---- Settings: the person's devices -----------------------------------------------------------------


class PushStatus(Model):
    # The key browsers subscribe with. None when push isn't set up for this deployment.
    public_key: str | None = None
    devices: list[PushDeviceView]


class WebPushKeys(Model):
    p256dh: str = Field(alias="p256dh", min_length=80, max_length=100)
    auth: str = Field(min_length=16, max_length=32)


class AddDeviceBody(Model):
    """A browser's PushSubscription.toJSON(), plus a label for the settings list."""

    kind: Literal["webpush"] = "webpush"
    endpoint: str = Field(max_length=1000)
    keys: WebPushKeys
    label: optional_text(80) = None  # type: ignore[valid-type]


class TestPushBody(Model):
    device_id: str | None = None


class TestPushResult(Model):
    sent: int


def _view(device: PushDevice) -> PushDeviceView:
    return PushDeviceView.model_validate(device.model_dump())


def device_id_for(endpoint: str) -> str:
    """Stable per subscription, so subscribing the same browser again updates its row."""
    return hashlib.sha256(endpoint.encode()).hexdigest()[:20]


def status(ctx: Ctx, user: User) -> PushStatus:
    return PushStatus(
        public_key=ctx.push.web_public_key,
        devices=[_view(d) for d in ctx.store.list_push_devices(user.user_id)],
    )


def add_device(ctx: Ctx, user: User, body: AddDeviceBody) -> PushDeviceView:
    if not ctx.push.enabled:
        raise Invalid("Push notifications aren't set up on this server yet")
    if not is_push_endpoint(body.endpoint):
        raise Invalid("That isn't a push service this app can send to")
    device_id = device_id_for(body.endpoint)
    existing = ctx.store.list_push_devices(user.user_id)
    same = next((d for d in existing if d.device_id == device_id), None)
    if not same and len(existing) >= MAX_DEVICES:
        # Make room by forgetting the device that has gone longest without a notification.
        stalest = min(existing, key=lambda d: d.last_sent_at or d.created_at)
        ctx.store.delete_push_device(user.user_id, stalest.device_id)
    device = PushDevice(
        device_id=device_id,
        user_id=user.user_id,
        kind=body.kind,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
        label=body.label,
        created_at=same.created_at if same else now_iso(),
        last_sent_at=same.last_sent_at if same else None,
    )
    ctx.store.put_push_device(device)
    return _view(device)


def remove_device(ctx: Ctx, user: User, device_id: str) -> None:
    if not any(d.device_id == device_id for d in ctx.store.list_push_devices(user.user_id)):
        raise NotFound("That device isn't set up for notifications")
    ctx.store.delete_push_device(user.user_id, device_id)


def send_test(ctx: Ctx, user: User, body: TestPushBody) -> TestPushResult:
    message = PushMessage(
        title="Worklight test",
        body="Push notifications are working on this device.",
        url=ctx.link("/account"),
        tag="test",
    )
    return TestPushResult(sent=push_to(ctx, user.user_id, message, body.device_id))
