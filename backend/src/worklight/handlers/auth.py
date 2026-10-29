"""Cognito custom-auth triggers for magic-link sign-in.

Cognito only passes ClientMetadata to these triggers on RespondToAuthChallenge, never on InitiateAuth,
so every sign-in starts with a no-op challenge:

  Request a link (any browser):
    InitiateAuth(CUSTOM_AUTH)                      -> challenge 1, nothing sent
    Respond("-", { mode: "request", next })        -> verify fails, challenge 2 emails the link

  Redeem the link (any browser or device):
    InitiateAuth(CUSTOM_AUTH)                      -> challenge 1, nothing sent
    Respond(code, { mode: "redeem" })              -> verify checks the code, tokens issued
"""

from functools import cache
from typing import Any

from worklight.config import get_app_url, require_env
from worklight.magic_link import MagicLinkDeps, redeem_magic_link, request_magic_link
from worklight.mailer import SesMailer
from worklight.store import DynamoStore

Event = dict[str, Any]


@cache
def _store() -> DynamoStore:
    return DynamoStore(require_env("TABLE_NAME"))


def pre_sign_up(event: Event, _context: Any) -> Event:
    """Magic-link users are created with a throwaway password and proven by the emailed link, so there is no
    separate confirmation step. Google users arrive already verified by Google."""
    response = event.setdefault("response", {})
    response["autoConfirmUser"] = True
    if event["request"].get("userAttributes", {}).get("email"):
        response["autoVerifyEmail"] = True
    return event


def define_auth_challenge(event: Event, _context: Any) -> Event:
    """Tokens are issued only when the latest custom challenge was answered with a valid code."""
    session = event["request"].get("session") or []
    response = event.setdefault("response", {})
    last = session[-1] if session else None
    if last and last.get("challengeName") == "CUSTOM_CHALLENGE" and last.get("challengeResult"):
        response.update(issueTokens=True, failAuthentication=False)
    elif len(session) >= 3:
        response.update(issueTokens=False, failAuthentication=True)
    else:
        response.update(challengeName="CUSTOM_CHALLENGE", issueTokens=False, failAuthentication=False)
    return event


def create_auth_challenge(event: Event, _context: Any) -> Event:
    request = event["request"]
    metadata = request.get("clientMetadata") or {}
    email = request.get("userAttributes", {}).get("email")
    step = "choose"
    if request.get("session") and metadata.get("mode") == "request" and email:
        deps = MagicLinkDeps(
            store=_store(), mailer=SesMailer(require_env("FROM_EMAIL")), app_url=get_app_url()
        )
        result = request_magic_link(deps, email, metadata.get("next") or "/")
        step = "email-sent" if result == "sent" else "email-throttled"
    event.setdefault("response", {}).update(
        publicChallengeParameters={"step": step},
        privateChallengeParameters={},
        challengeMetadata=f"MAGIC_LINK_{step.upper().replace('-', '_')}",
    )
    return event


def verify_auth_challenge(event: Event, _context: Any) -> Event:
    request = event["request"]
    metadata = request.get("clientMetadata") or {}
    email = request.get("userAttributes", {}).get("email")
    answer = request.get("challengeAnswer")
    correct = (
        metadata.get("mode") == "redeem"
        and bool(email)
        and isinstance(answer, str)
        and len(answer) > 20
        and redeem_magic_link(_store(), email, answer)
    )
    event.setdefault("response", {})["answerCorrect"] = correct
    return event
