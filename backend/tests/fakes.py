import re

from worklight.mailer import Email
from worklight.models import PushDevice
from worklight.push import PushMessage
from worklight.webpush import SendResult


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[Email] = []

    def send(self, email: Email) -> None:
        self.sent.append(email)

    def last_link(self) -> str:
        assert self.sent, "no email sent"
        match = re.search(r"https?://\S+", self.sent[-1].text)
        assert match, "no link in the last email"
        return match.group(0)


class FakePush:
    """A web push channel that records what it would send. Endpoints listed in gone answer like an ended
    subscription (410)."""

    kind = "webpush"
    public_key = "BFakePublicKey"

    def __init__(self) -> None:
        self.sent: list[tuple[PushDevice, PushMessage]] = []
        self.gone: set[str] = set()

    def deliver(self, device: PushDevice, message: PushMessage) -> SendResult:
        if device.endpoint in self.gone:
            return "gone"
        self.sent.append((device, message))
        return "sent"

    def titles_for(self, endpoint: str) -> list[str]:
        return [m.title for d, m in self.sent if d.endpoint == endpoint]
