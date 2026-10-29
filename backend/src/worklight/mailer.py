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
    return f"""<!doctype html><html><body style="margin:0;background:#FAF7F2">
<div style="font-family:'IBM Plex Sans',system-ui,sans-serif;max-width:480px;margin:0 auto;padding:28px 20px;color:#1E1A16">
<p style="margin:0 0 20px;font-family:Georgia,serif;font-weight:700;font-size:18px;color:#221D1A">Worklight</p>
<h2 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px">{escape(heading)}</h2>
<p style="line-height:1.5;margin:0 0 20px">{body}</p>
<p style="margin:0 0 24px"><a href="{escape(url)}" style="display:inline-block;background:#6D3B8E;color:#fff;padding:13px 22px;border-radius:6px;text-decoration:none;font-weight:700">{escape(button_label)}</a></p>
<p style="color:#6E665C;font-size:13px;line-height:1.5">Or paste this link into your browser:<br>{escape(url)}</p>
</div></body></html>"""  # noqa: E501


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


def invite_email(
    to: str, show_name: str, inviter_name: str, url: str, invitee_name: str | None = None
) -> Email:
    hello = f"Hi {invitee_name.split()[0]}, " if invitee_name else ""
    return Email(
        to=to,
        subject=f"You're invited to {show_name} on Worklight",
        text=(
            f"{hello}{inviter_name} invited you to {show_name} on Worklight, where you will enter your "
            "conflicts "
            f"and see your rehearsal calls.\n\nThis link signs you in and takes you to the show:\n{url}\n\n"
            "This invite expires in 30 days."
        ),
        html=_layout(
            f"Join {show_name}",
            f"{escape(hello)}{escape(inviter_name)} invited you to <strong>{escape(show_name)}</strong> on "
            "Worklight, where you'll enter your conflicts and see your rehearsal calls. The button signs you "
            "in, no password needed. This invite expires in 30 days.",
            "Join the show",
            url,
        ),
    )


def conflicts_reminder_email(
    to: str, show_name: str, sender_name: str, url: str, deadline: str | None
) -> Email:
    due = f" by {_pretty_date(deadline)}" if deadline else ""
    return Email(
        to=to,
        subject=f"{show_name}: please send your conflicts{due}",
        text=(
            f"{sender_name} needs your rehearsal conflicts for {show_name}{due}. It takes about two minutes:"
            f"\n\n{url}"
        ),
        html=_layout(
            "Send your conflicts",
            f"{escape(sender_name)} needs your rehearsal conflicts for <strong>{escape(show_name)}</strong>"
            f"{escape(due)}. It takes about two minutes.",
            "Enter my conflicts",
            url,
        ),
    )


def admin_added_email(to: str, theater_name: str, sender_name: str, url: str) -> Email:
    return Email(
        to=to,
        subject=f"You're now an admin of {theater_name} on Worklight",
        text=(
            f"{sender_name} made you a company admin of {theater_name} on Worklight. You can see and run "
            f"every show.\n\n{url}"
        ),
        html=_layout(
            f"Welcome to {theater_name}",
            f"{escape(sender_name)} made you a company admin of <strong>{escape(theater_name)}</strong>. You "
            "can see and run every show, add shows, and manage staff.",
            "Open Worklight",
            url,
        ),
    )


def _pretty_date(iso: str) -> str:
    from datetime import date

    d = date.fromisoformat(iso)
    return f"{d.strftime('%A, %B')} {d.day}"
