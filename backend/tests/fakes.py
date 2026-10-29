import re

from worklight.mailer import Email


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
