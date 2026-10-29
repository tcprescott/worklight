import base64
import hashlib
import secrets
import time
from datetime import UTC, datetime


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def new_id() -> str:
    """Short, URL-safe id for theaters, shows and users."""
    return _b64url(secrets.token_bytes(12))


def new_token() -> str:
    """Long unguessable token for invite links, magic links and calendar feeds."""
    return _b64url(secrets.token_bytes(32))


def sha256(value: str) -> str:
    return _b64url(hashlib.sha256(value.encode()).digest())


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def now_epoch() -> int:
    return int(time.time())
