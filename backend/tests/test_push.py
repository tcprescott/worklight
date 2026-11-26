import hashlib
import hmac
import json
import os
from datetime import UTC, datetime

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from tests.client import DIRECTOR, Client
from tests.fakes import FakeMailer, FakePush
from tests.test_schedule import _show
from worklight import clock
from worklight.push import PushMessage
from worklight.services.notify import send_reminders
from worklight.webpush import VapidKey, b64url, encrypt, is_push_endpoint, unb64url

WEEK = {"from": "2026-11-09", "to": "2026-11-15"}
FCM = "https://fcm.googleapis.com/fcm/send/"


def _browser() -> tuple[ec.EllipticCurvePrivateKey, str, str]:
    """What a browser holds for a subscription: its private key, and the p256dh and auth it hands us."""
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return key, b64url(public), b64url(os.urandom(16))


def _decrypt(key: ec.EllipticCurvePrivateKey, p256dh: str, auth: str, body: bytes) -> bytes:
    """The browser's side of RFC 8291, written out separately from the code under test."""
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    sender_public = body[21 : 21 + idlen]
    assert rs == 4096 and idlen == 65
    sender = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), sender_public)
    shared = key.exchange(ec.ECDH(), sender)

    def hkdf(salt: bytes, ikm: bytes, info: bytes, n: int) -> bytes:
        prk = hmac.new(salt, ikm, hashlib.sha256).digest()
        return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]

    ikm = hkdf(unb64url(auth), shared, b"WebPush: info\x00" + unb64url(p256dh) + sender_public, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, body[21 + idlen :], None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


def test_payloads_decrypt_on_the_browser_side() -> None:
    key, p256dh, auth = _browser()
    message = PushMessage(
        title="Our Town · tomorrow 7:00 PM", body="Act 1 at the hall.", url="https://w.test/x"
    )
    body = encrypt(p256dh, auth, message.payload())
    assert json.loads(_decrypt(key, p256dh, auth, body)) == {
        "title": "Our Town · tomorrow 7:00 PM",
        "body": "Act 1 at the hall.",
        "url": "https://w.test/x",
        "tag": None,
    }


def test_vapid_header_is_a_signed_jwt_for_the_push_service() -> None:
    vapid = VapidKey.from_pem(VapidKey.generate().to_pem())
    header = vapid.authorization(FCM + "abc", "mailto:calls@example.org")
    token, k = header.removeprefix("vapid t=").split(", k=")
    assert k == vapid.public_key
    head, claims, sig = token.split(".")
    assert json.loads(unb64url(claims))["aud"] == "https://fcm.googleapis.com"
    assert json.loads(unb64url(claims))["sub"] == "mailto:calls@example.org"
    raw = unb64url(sig)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    vapid.private_key.public_key().verify(der, f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))


def test_only_sends_to_browser_push_services() -> None:
    assert is_push_endpoint(FCM + "abc")
    assert is_push_endpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")
    assert is_push_endpoint("https://web.push.apple.com/QF1")
    assert not is_push_endpoint("http://fcm.googleapis.com/fcm/send/abc")
    assert not is_push_endpoint("https://fcm.googleapis.com.evil.example/abc")
    assert not is_push_endpoint("https://169.254.169.254/latest/meta-data")
    assert not is_push_endpoint("https://fcm.googleapis.com:8443/abc")


def _subscribe(call: Client, email: str, endpoint: str) -> str:
    _, p256dh, auth = _browser()
    device = call.ok(
        email,
        "PUT",
        "/api/me/push/devices",
        {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}, "label": "Chrome on Android"},
    )
    return str(device["deviceId"])


def test_devices_can_be_added_tested_and_removed(call: Client, pusher: FakePush) -> None:
    me = "maya@example.org"
    assert call.ok(me, "GET", "/api/me/push") == {"publicKey": "BFakePublicKey", "devices": []}

    status, err = call(me, "PUT", "/api/me/push/devices", {
        "endpoint": "https://example.org/collect", "keys": {"p256dh": _browser()[1], "auth": _browser()[2]}
    })  # fmt: skip
    assert status == 400 and "push service" in err["error"]

    phone = _subscribe(call, me, FCM + "phone")
    assert _subscribe(call, me, FCM + "phone") == phone  # Subscribing again updates the same device.
    laptop = _subscribe(call, me, FCM + "laptop")
    devices = call.ok(me, "GET", "/api/me/push")["devices"]
    assert [d["deviceId"] for d in devices] == [phone, laptop]
    assert "endpoint" not in devices[0]

    assert call.ok(me, "POST", "/api/me/push/test", {"deviceId": phone}) == {"sent": 1}
    assert pusher.titles_for(FCM + "phone") == ["Worklight test"]
    assert pusher.titles_for(FCM + "laptop") == []

    # Someone else can't remove Maya's device.
    assert call("jay@example.org", "DELETE", f"/api/me/push/devices/{phone}")[0] == 404
    call.ok(me, "DELETE", f"/api/me/push/devices/{phone}")
    assert [d["deviceId"] for d in call.ok(me, "GET", "/api/me/push")["devices"]] == [laptop]


def test_ended_subscriptions_are_dropped(call: Client, pusher: FakePush) -> None:
    me = "maya@example.org"
    _subscribe(call, me, FCM + "old")
    pusher.gone.add(FCM + "old")
    assert call.ok(me, "POST", "/api/me/push/test", {}) == {"sent": 0}
    assert call.ok(me, "GET", "/api/me/push")["devices"] == []


def test_publish_reminders_and_notices_push_by_preference(
    call: Client, mailer: FakeMailer, pusher: FakePush, monkeypatch: pytest.MonkeyPatch
) -> None:
    show = _show(call, mailer)
    base = show["base"]
    _subscribe(call, "maya@example.org", FCM + "maya")
    _subscribe(call, "jay@example.org", FCM + "jay")
    # Jay wants pushes only, no emails, for changes; and no reminder pushes.
    call.ok("jay@example.org", "PATCH", "/api/me", {"prefs": {"changeEmails": False, "pushReminders": False}})

    call.ok(DIRECTOR, "POST", f"{base}/schedule/2026-11-09/scenes", {"sceneId": show["s1"]})
    mailer.sent.clear()
    assert call.ok(DIRECTOR, "POST", f"{base}/schedule/publish", WEEK)["notified"] == 2
    assert [m.to for m in mailer.sent] == ["maya@example.org"]
    assert pusher.titles_for(FCM + "jay") == ["Our Town · your calls are up"]
    maya_push = next(m for d, m in pusher.sent if d.endpoint == FCM + "maya")
    assert maya_push.body.startswith("Monday, November 9, 7:00 PM to 7:50 PM: 1.1 Theseus's palace")
    assert maya_push.url == f"https://worklight.test/shows/{show['id']}/calls"
    assert not maya_push.urgent  # Ten days away.

    pusher.sent.clear()
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 11, 9, 1, 30, tzinfo=UTC))
    assert send_reminders(call.ctx) == 2
    assert pusher.titles_for(FCM + "maya") == ["Our Town · tomorrow 7:00 PM"]
    assert pusher.titles_for(FCM + "jay") == []

    pusher.sent.clear()
    call.ok(DIRECTOR, "POST", f"{base}/notices", {"title": "Fittings", "body": "Saturday at 10."})
    assert sorted(d.endpoint for d, _ in pusher.sent) == [FCM + "jay", FCM + "maya"]
    assert pusher.sent[0][1].title == "Our Town · Fittings"
    assert pusher.sent[0][1].url.endswith("/callboard")


def test_without_push_set_up_devices_cant_be_added(store, mailer: FakeMailer) -> None:  # type: ignore[no-untyped-def]
    call = Client(store, mailer)
    assert call.ok("maya@example.org", "GET", "/api/me/push") == {"devices": []}
    _, p256dh, auth = _browser()
    status, _ = call("maya@example.org", "PUT", "/api/me/push/devices", {
        "endpoint": FCM + "x", "keys": {"p256dh": p256dh, "auth": auth}
    })  # fmt: skip
    assert status == 400


def test_long_bodies_are_trimmed_to_fit_a_push() -> None:
    message = PushMessage(title="t", body="x" * 5000, url="u")
    assert len(json.loads(message.payload())["body"]) == 600
