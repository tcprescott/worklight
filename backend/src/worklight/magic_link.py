from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlencode

from worklight.ids import new_token, now_epoch, sha256
from worklight.keys import normalize_email
from worklight.mailer import Mailer, magic_link_email
from worklight.models import MagicLinkRecord
from worklight.store import Store

MAGIC_LINK_TTL_SECONDS = 15 * 60
# A new link can't be requested more often than this, which caps email cost per address.
MAGIC_LINK_RESEND_SECONDS = 60


@dataclass(frozen=True)
class MagicLinkDeps:
    store: Store
    mailer: Mailer
    app_url: str


def request_magic_link(
    deps: MagicLinkDeps, raw_email: str, redirect_path: str = "/"
) -> Literal["sent", "throttled"]:
    email = normalize_email(raw_email)
    now = now_epoch()
    existing = deps.store.get_magic_link(email)
    if existing and now - existing.created_at < MAGIC_LINK_RESEND_SECONDS and existing.expires_at > now:
        return "throttled"
    code = new_token()
    deps.store.put_magic_link(
        MagicLinkRecord(
            email=email, code_hash=sha256(code), created_at=now, expires_at=now + MAGIC_LINK_TTL_SECONDS
        )
    )
    params = {"email": email, "code": code}
    if redirect_path.startswith("/") and not redirect_path.startswith("//"):
        params["next"] = redirect_path
    deps.mailer.send(magic_link_email(email, f"{deps.app_url.rstrip('/')}/auth/magic?{urlencode(params)}"))
    return "sent"


def redeem_magic_link(store: Store, raw_email: str, code: str) -> bool:
    """True once per code: a correct, unexpired code is deleted as it is redeemed."""
    email = normalize_email(raw_email)
    record = store.get_magic_link(email)
    if not record or record.expires_at < now_epoch():
        return False
    code_hash = sha256(code)
    if code_hash != record.code_hash:
        return False
    return store.consume_magic_link(email, code_hash)
