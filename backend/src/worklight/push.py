"""Push channels. Each kind of device (browser now, native app later) has a sender that knows how to reach it.

Adding a channel means writing a PushSender for its kind and passing it to Pusher; nothing that decides who
gets told what needs to change.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Protocol

from worklight.models import PushDevice
from worklight.webpush import SendResult, WebPushSender


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    # Where tapping the notification goes, as an absolute URL into the app.
    url: str
    # A newer notification with the same tag replaces the older one on the device.
    tag: str | None = None
    # Same-day changes skip the push service's battery-saving delays.
    urgent: bool = False

    def payload(self) -> bytes:
        data = asdict(self)
        data.pop("urgent")
        # Push services cap payloads near 4 KB; keep well under once encrypted.
        data["body"] = data["body"] if len(data["body"]) <= 600 else data["body"][:597] + "..."
        return json.dumps(data, separators=(",", ":")).encode()


class PushSender(Protocol):
    kind: str

    def deliver(self, device: PushDevice, message: PushMessage) -> SendResult: ...


class WebPushChannel:
    """Browser subscriptions, through the vendor push services."""

    kind = "webpush"

    def __init__(self, sender: WebPushSender) -> None:
        self.sender = sender

    @property
    def public_key(self) -> str:
        return self.sender.public_key

    def deliver(self, device: PushDevice, message: PushMessage) -> SendResult:
        return self.sender.send(
            device.endpoint, device.p256dh, device.auth, message.payload(), urgent=message.urgent
        )


class Pusher:
    """The push channels this deployment can use. With none, push is off and only email goes out."""

    def __init__(self, senders: Iterable[PushSender] = ()) -> None:
        self.senders = {s.kind: s for s in senders}

    @property
    def enabled(self) -> bool:
        return bool(self.senders)

    @property
    def web_public_key(self) -> str | None:
        web = self.senders.get("webpush")
        key = getattr(web, "public_key", None)
        return key if isinstance(key, str) else None

    def deliver(self, device: PushDevice, message: PushMessage) -> SendResult | None:
        """None when this deployment has no sender for the device's kind."""
        sender = self.senders.get(device.kind)
        return sender.deliver(device, message) if sender else None
