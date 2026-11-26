"""Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291).

Written against `cryptography` alone, so the Lambda bundle needs no push library. The browser gives us
an endpoint URL on its vendor's push service plus two keys; we encrypt the message to those keys and POST
it there.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

log = logging.getLogger(__name__)

SendResult = Literal["sent", "gone", "failed"]

# Push services run by the browser vendors. We only ever POST to these, so a stored endpoint can't be used to
# make the server call somewhere else.
PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "push.apple.com",
    "notify.windows.com",
)

RECORD_SIZE = 4096


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def is_push_endpoint(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and parts.port in (None, 443)
        and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)
    )


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def _hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    # Every output here is 32 bytes or less, so one HMAC block is enough.
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


def encrypt(p256dh: str, auth: str, payload: bytes, *, salt: bytes | None = None) -> bytes:
    """Encrypts one message for a browser subscription as a single aes128gcm record (RFC 8291)."""
    ua_public = unb64url(p256dh)
    auth_secret = unb64url(auth)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public = _public_bytes(as_private.public_key())
    shared = as_private.exchange(ec.ECDH(), ua_key)

    ikm = _hkdf_expand(_hkdf_extract(auth_secret, shared), b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or os.urandom(16)
    prk = _hkdf_extract(salt, ikm)
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + body


@dataclass(frozen=True)
class VapidKey:
    """The server's identity to push services. Browsers get the public half when they subscribe."""

    private_key: ec.EllipticCurvePrivateKey

    @classmethod
    def generate(cls) -> VapidKey:
        return cls(ec.generate_private_key(ec.SECP256R1()))

    @classmethod
    def from_pem(cls, pem: str) -> VapidKey:
        key = serialization.load_pem_private_key(pem.encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("The VAPID key must be a P-256 EC private key")
        return cls(key)

    def to_pem(self) -> str:
        return self.private_key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()

    @property
    def public_key(self) -> str:
        """The applicationServerKey the browser's PushManager.subscribe() wants."""
        return b64url(_public_bytes(self.private_key.public_key()))

    def authorization(self, endpoint: str, subject: str, ttl: int = 12 * 3600) -> str:
        parts = urlsplit(endpoint)
        header = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
        claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(time.time()) + ttl, "sub": subject}
        body = b64url(json.dumps(claims, separators=(",", ":")).encode())
        signing_input = f"{header}.{body}".encode()
        r, s = decode_dss_signature(self.private_key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
        signature = b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
        return f"vapid t={header}.{body}.{signature}, k={self.public_key}"


class WebPushSender:
    """Sends to browser subscriptions. 404 or 410 from the push service means the subscription is gone."""

    kind = "webpush"

    def __init__(self, vapid: VapidKey, subject: str, timeout: float = 5.0) -> None:
        self.vapid = vapid
        self.subject = subject if subject.startswith(("mailto:", "https:")) else f"mailto:{subject}"
        self.timeout = timeout

    @property
    def public_key(self) -> str:
        return self.vapid.public_key

    def send(
        self, endpoint: str, p256dh: str, auth: str, payload: bytes, *, urgent: bool = False
    ) -> SendResult:
        if not is_push_endpoint(endpoint):
            log.warning("Refusing to push to an unknown host: %s", urlsplit(endpoint).hostname)
            return "gone"
        request = urllib.request.Request(  # noqa: S310 (https and an allowlisted host, checked above)
            endpoint,
            data=encrypt(p256dh, auth, payload),
            method="POST",
            headers={
                "Authorization": self.vapid.authorization(endpoint, self.subject),
                "Content-Encoding": "aes128gcm",
                "Content-Type": "application/octet-stream",
                "TTL": str(24 * 3600),
                "Urgency": "high" if urgent else "normal",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as res:  # noqa: S310
                return "sent" if 200 <= res.status < 300 else "failed"
        except urllib.error.HTTPError as err:
            if err.code in (404, 410):
                return "gone"
            log.warning("Push service answered %s for %s", err.code, urlsplit(endpoint).hostname)
            return "failed"
        except (urllib.error.URLError, TimeoutError) as err:
            log.warning("Push to %s failed: %s", urlsplit(endpoint).hostname, err)
            return "failed"
