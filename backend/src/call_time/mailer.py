from __future__ import annotations

from dataclasses import dataclass
from html import escape
from typing import TYPE_CHECKING, Protocol

import boto3

if TYPE_CHECKING:
    from mypy_boto3_sesv2.client import SESV2Client


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str
    html: str


class Mailer(Protocol):
    def send(self, email: Email) -> None: ...


class SesMailer:
    def __init__(self, sender: str, client: SESV2Client | None = None) -> None:
        self.sender = sender
        self.client: SESV2Client = client or boto3.client("sesv2")

    def send(self, email: Email) -> None:
        self.client.send_email(
            FromEmailAddress=self.sender,
            Destination={"ToAddresses": [email.to]},
            Content={
                "Simple": {
                    "Subject": {"Data": email.subject, "Charset": "UTF-8"},
                    "Body": {
                        "Text": {"Data": email.text, "Charset": "UTF-8"},
                        "Html": {"Data": email.html, "Charset": "UTF-8"},
                    },
                }
            },
        )


def _layout(heading: str, body: str, button_label: str, url: str) -> str:
    return f"""<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;color:#1f1f1f">
<h2 style="margin:0 0 12px">{escape(heading)}</h2>
<p style="line-height:1.5">{body}</p>
<p><a href="{escape(url)}" style="display:inline-block;background:#7a2e2e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">{escape(button_label)}</a></p>
<p style="color:#666;font-size:13px">Or paste this link into your browser:<br>{escape(url)}</p>
</body></html>"""  # noqa: E501


def magic_link_email(to: str, url: str) -> Email:
    note = (
        "This link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email."
    )
    return Email(
        to=to,
        subject="Your Worklight sign-in link",
        text=f"Sign in to Worklight:\n\n{url}\n\n{note}",
        html=_layout("Sign in to Worklight", escape(note), "Sign in", url),
    )


def invite_email(to: str, show_name: str, inviter_name: str, url: str) -> Email:
    return Email(
        to=to,
        subject=f"You're invited to {show_name} on Worklight",
        text=(
            f"{inviter_name} invited you to {show_name} on Worklight, where you'll enter your conflicts "
            f"and see your rehearsal calls.\n\nJoin here:\n{url}\n\nThis invite expires in 30 days."
        ),
        html=_layout(
            f"Join {show_name}",
            f"{escape(inviter_name)} invited you to <strong>{escape(show_name)}</strong> on Worklight, where "
            "you'll enter your conflicts and see your rehearsal calls. This invite expires in 30 days.",
            "Join the show",
            url,
        ),
    )
