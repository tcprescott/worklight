from urllib.parse import parse_qs, urlparse

import pytest

from tests.fakes import FakeMailer, MemoryStore
from worklight import magic_link
from worklight.handlers import auth
from worklight.magic_link import (
    MAGIC_LINK_RESEND_SECONDS,
    MagicLinkDeps,
    redeem_magic_link,
    request_magic_link,
)


class Clock:
    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.now = 1_793_534_400  # 2026-11-01T12:00:00Z
        monkeypatch.setattr(magic_link, "now_epoch", lambda: self.now)

    def advance(self, seconds: int) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    return Clock(monkeypatch)


@pytest.fixture
def deps(store: MemoryStore, mailer: FakeMailer) -> MagicLinkDeps:
    return MagicLinkDeps(store=store, mailer=mailer, app_url="https://worklight.test")


def code_from_email(mailer: FakeMailer) -> tuple[str, str, str | None]:
    url = urlparse(mailer.last_link())
    assert url.path == "/auth/magic"
    query = parse_qs(url.query)
    return query["email"][0], query["code"][0], query.get("next", [None])[0]


class TestMagicLinks:
    def test_emails_a_link_whose_code_signs_in_exactly_once(
        self, deps: MagicLinkDeps, store: MemoryStore, mailer: FakeMailer
    ) -> None:
        assert request_magic_link(deps, "Pat@Example.org", "/invite/abc") == "sent"
        email, code, next_path = code_from_email(mailer)
        assert email == "pat@example.org"
        assert next_path == "/invite/abc"
        assert store.magic_links[email].code_hash != code

        assert not redeem_magic_link(store, email, "wrong-code-wrong-code-wrong")
        assert redeem_magic_link(store, email, code)
        assert not redeem_magic_link(store, email, code)

    def test_drops_redirect_targets_that_leave_the_site(
        self, deps: MagicLinkDeps, mailer: FakeMailer
    ) -> None:
        request_magic_link(deps, "pat@example.org", "//evil.example")
        assert code_from_email(mailer)[2] is None

    def test_throttles_repeat_requests_to_one_email_a_minute(
        self, deps: MagicLinkDeps, mailer: FakeMailer, clock: Clock
    ) -> None:
        assert request_magic_link(deps, "pat@example.org") == "sent"
        assert request_magic_link(deps, "pat@example.org") == "throttled"
        assert len(mailer.sent) == 1
        clock.advance(MAGIC_LINK_RESEND_SECONDS + 1)
        assert request_magic_link(deps, "pat@example.org") == "sent"
        assert len(mailer.sent) == 2

    def test_expires_after_15_minutes(
        self, deps: MagicLinkDeps, store: MemoryStore, mailer: FakeMailer, clock: Clock
    ) -> None:
        request_magic_link(deps, "pat@example.org")
        email, code, _ = code_from_email(mailer)
        clock.advance(16 * 60)
        assert not redeem_magic_link(store, email, code)

    def test_only_the_newest_link_works(
        self, deps: MagicLinkDeps, store: MemoryStore, mailer: FakeMailer, clock: Clock
    ) -> None:
        request_magic_link(deps, "pat@example.org")
        first = code_from_email(mailer)
        clock.advance(2 * 60)
        request_magic_link(deps, "pat@example.org")
        second = code_from_email(mailer)
        assert not redeem_magic_link(store, first[0], first[1])
        assert redeem_magic_link(store, second[0], second[1])


class TestDefineAuthChallenge:
    @staticmethod
    def run(session: list[dict[str, object]]) -> dict[str, object]:
        result: dict[str, object] = auth.define_auth_challenge(
            {"request": {"session": session}, "response": {}}, None
        )["response"]
        return result

    @staticmethod
    def attempt(result: bool) -> dict[str, object]:
        return {"challengeName": "CUSTOM_CHALLENGE", "challengeResult": result}

    def test_starts_with_a_custom_challenge(self) -> None:
        assert self.run([]) | {} == {
            "challengeName": "CUSTOM_CHALLENGE",
            "issueTokens": False,
            "failAuthentication": False,
        }

    def test_issues_tokens_after_a_correct_answer(self) -> None:
        assert self.run([self.attempt(True)]) == {"issueTokens": True, "failAuthentication": False}

    def test_asks_again_after_the_request_step_then_gives_up(self) -> None:
        assert self.run([self.attempt(False)])["challengeName"] == "CUSTOM_CHALLENGE"
        assert self.run([self.attempt(False)] * 3)["failAuthentication"] is True


class TestChallengeTriggers:
    @pytest.fixture(autouse=True)
    def _wire(self, monkeypatch: pytest.MonkeyPatch, store: MemoryStore, mailer: FakeMailer) -> None:
        monkeypatch.setattr(auth, "_store", lambda: store)
        monkeypatch.setattr(auth, "SesMailer", lambda _sender: mailer)
        monkeypatch.setattr(auth, "get_app_url", lambda: "https://worklight.test")
        monkeypatch.setenv("FROM_EMAIL", "no-reply@worklight.test")

    @staticmethod
    def event(
        session: list[object], metadata: dict[str, str], answer: str | None = None
    ) -> dict[str, object]:
        return {
            "request": {
                "userAttributes": {"email": "pat@example.org"},
                "session": session,
                "clientMetadata": metadata,
                "challengeAnswer": answer,
            },
            "response": {},
        }

    def test_first_challenge_sends_nothing(self, mailer: FakeMailer) -> None:
        res = auth.create_auth_challenge(self.event([], {"mode": "request"}), None)["response"]
        assert res["publicChallengeParameters"] == {"step": "choose"}
        assert mailer.sent == []

    def test_request_then_redeem_signs_in(self, mailer: FakeMailer) -> None:
        sent = auth.create_auth_challenge(self.event([{}], {"mode": "request", "next": "/invite/x"}), None)
        assert sent["response"]["publicChallengeParameters"] == {"step": "email-sent"}
        _, code, next_path = code_from_email(mailer)
        assert next_path == "/invite/x"

        assert auth.verify_auth_challenge(self.event([{}], {"mode": "request"}, code), None)["response"] == {
            "answerCorrect": False
        }
        verified = auth.verify_auth_challenge(self.event([{}], {"mode": "redeem"}, code), None)
        assert verified["response"]["answerCorrect"] is True

    def test_pre_sign_up_confirms_and_verifies(self) -> None:
        res = auth.pre_sign_up(
            {"request": {"userAttributes": {"email": "pat@example.org"}}, "response": {}}, None
        )
        assert res["response"] == {"autoConfirmUser": True, "autoVerifyEmail": True}
