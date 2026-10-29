import re
from collections.abc import Iterable

from call_time.keys import normalize_email
from call_time.mailer import Email
from call_time.models import Invite, MagicLinkRecord, Membership, Show, Theater, User


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


class MemoryStore:
    """In-memory Store with the same semantics as DynamoStore."""

    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.emails: dict[str, str] = {}
        self.theaters: dict[str, Theater] = {}
        self.admins: set[tuple[str, str]] = set()
        self.shows: dict[str, Show] = {}
        self.members: dict[tuple[str, str], Membership] = {}
        self.invites: dict[str, Invite] = {}
        self.magic_links: dict[str, MagicLinkRecord] = {}

    def get_user(self, user_id: str) -> User | None:
        return self.users.get(user_id)

    def get_user_id_by_email(self, email: str) -> str | None:
        return self.emails.get(normalize_email(email))

    def create_user(self, user: User) -> str:
        email = normalize_email(user.email)
        if email in self.emails:
            return self.emails[email]
        self.emails[email] = user.user_id
        self.users[user.user_id] = user.model_copy(update={"email": email})
        return user.user_id

    def update_user_name(self, user_id: str, name: str) -> None:
        self.users[user_id] = self.users[user_id].model_copy(update={"name": name})

    def get_users(self, user_ids: Iterable[str]) -> list[User]:
        return [self.users[u] for u in dict.fromkeys(user_ids) if u in self.users]

    def create_theater(self, theater: Theater, admin_user_id: str) -> None:
        self.theaters[theater.theater_id] = theater
        self.admins.add((theater.theater_id, admin_user_id))

    def get_theater(self, theater_id: str) -> Theater | None:
        return self.theaters.get(theater_id)

    def list_admin_theater_ids(self, user_id: str) -> list[str]:
        return [t for t, u in self.admins if u == user_id]

    def is_theater_admin(self, theater_id: str, user_id: str) -> bool:
        return (theater_id, user_id) in self.admins

    def create_show(self, show: Show, creator: Membership) -> None:
        self.shows[show.show_id] = show
        self.members[(creator.show_id, creator.user_id)] = creator

    def get_show(self, show_id: str) -> Show | None:
        return self.shows.get(show_id)

    def get_shows(self, refs: Iterable[tuple[str, str]]) -> list[Show]:
        return [self.shows[s] for _, s in refs if s in self.shows]

    def list_memberships(self, user_id: str) -> list[Membership]:
        return [m for m in self.members.values() if m.user_id == user_id]

    def get_membership(self, show_id: str, user_id: str) -> Membership | None:
        return self.members.get((show_id, user_id))

    def list_members(self, show_id: str) -> list[Membership]:
        return [m for m in self.members.values() if m.show_id == show_id]

    def put_invite(self, invite: Invite) -> None:
        self.invites[invite.token] = invite

    def get_invite(self, token: str) -> Invite | None:
        return self.invites.get(token)

    def accept_invite(self, invite: Invite, membership: Membership) -> None:
        if invite.token not in self.invites:
            raise RuntimeError("TransactionCanceledException")
        del self.invites[invite.token]
        self.members[(membership.show_id, membership.user_id)] = membership

    def get_magic_link(self, email: str) -> MagicLinkRecord | None:
        return self.magic_links.get(normalize_email(email))

    def put_magic_link(self, record: MagicLinkRecord) -> None:
        email = normalize_email(record.email)
        self.magic_links[email] = record.model_copy(update={"email": email})

    def consume_magic_link(self, email: str, code_hash: str) -> bool:
        record = self.magic_links.get(normalize_email(email))
        if not record or record.code_hash != code_hash:
            return False
        del self.magic_links[normalize_email(email)]
        return True
