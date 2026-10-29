import re
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BeforeValidator, StringConstraints

from worklight import keys
from worklight.ids import new_id, now_iso
from worklight.mailer import Mailer
from worklight.models import Membership, Show, ShowRole, User
from worklight.roles import ShowAction, can_on_show
from worklight.store import Store


class ServiceError(Exception):
    status = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class Invalid(ServiceError):
    status = 400


class Unauthorized(ServiceError):
    status = 401


class Forbidden(ServiceError):
    status = 403

    def __init__(self, message: str = "You don't have access to this") -> None:
        super().__init__(message)


class NotFound(ServiceError):
    status = 404


class Conflict(ServiceError):
    status = 409


@dataclass(frozen=True)
class Ctx:
    store: Store
    mailer: Mailer
    # Public site origin, e.g. https://worklight.example.org. Used in emailed links.
    app_url: str

    def link(self, path: str) -> str:
        return f"{self.app_url.rstrip('/')}{path}"


# ---- Shared input types ---------------------------------------------------------------------------


def text(max_length: int) -> Any:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


def blank_to_none(value: object) -> object:
    return None if isinstance(value, str) and value.strip() == "" else value


def _check_date(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("must be a date like 2026-11-02")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("must be a date like 2026-11-02") from None
    return value


def _check_time(value: str) -> str:
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("must be a time like 19:30")
    return value


def _check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("must be an IANA timezone like America/Chicago") from None
    return value


def _check_email(value: str) -> str:
    if not keys.is_email(value):
        raise ValueError("must be a valid email address")
    return keys.normalize_email(value)


IsoDate = Annotated[str, AfterValidator(_check_date)]
OptionalDate = Annotated[
    str | None,
    BeforeValidator(blank_to_none),
    AfterValidator(lambda v: None if v is None else _check_date(v)),
]
Time = Annotated[str, AfterValidator(_check_time)]
OptionalTime = Annotated[
    str | None,
    BeforeValidator(blank_to_none),
    AfterValidator(lambda v: None if v is None else _check_time(v)),
]
Timezone = Annotated[str, AfterValidator(_check_timezone)]
Email = Annotated[str, AfterValidator(_check_email)]


def optional_text(max_length: int) -> Any:
    """Optional text where a blank string means "none"."""
    return Annotated[Annotated[str, text(max_length)] | None, BeforeValidator(blank_to_none)]


def maybe_text(max_length: int) -> Any:
    """Text that may be left out of an edit, but can't be blank when sent."""
    return Annotated[str, text(max_length)] | None


# ---- Users and access -----------------------------------------------------------------------------


def user_for_email(ctx: Ctx, email: str, name: str | None = None) -> User:
    """The user with this email, creating one (as when they're first invited or first sign in)."""
    email = keys.normalize_email(email)
    existing_id = ctx.store.get_user_id_by_email(email)
    if existing_id and (existing := ctx.store.get_user(existing_id)):
        return existing
    user = User(user_id=new_id(), email=email, name=name, created_at=now_iso())
    user_id = ctx.store.create_user(user)
    return user if user_id == user.user_id else (ctx.store.get_user(user_id) or user)


@dataclass(frozen=True)
class ShowAccess:
    show: Show
    role: ShowRole | None
    membership: Membership | None
    # A company admin who isn't in the show gets staff rights through the theater.
    via_admin: bool

    def can(self, action: ShowAction) -> bool:
        return can_on_show(self.role, action)

    def require(self, action: ShowAction) -> "ShowAccess":
        if not self.can(action):
            raise Forbidden()
        return self

    def require_open(self) -> "ShowAccess":
        """Archived shows are read-only."""
        if self.show.status == "archived":
            raise Conflict("This show is archived, so it can't be changed. Restore it first.")
        return self


def show_access(ctx: Ctx, show_id: str, user: User) -> ShowAccess:
    show = ctx.store.get_show(show_id)
    if not show:
        raise NotFound("Show not found")
    membership = ctx.store.get_membership(show_id, user.user_id)
    is_admin = ctx.store.is_theater_admin(show.theater_id, user.user_id)
    if membership:
        role: ShowRole = "staff" if is_admin else membership.role
        return ShowAccess(show, role, membership, via_admin=False)
    if is_admin:
        return ShowAccess(show, "staff", None, via_admin=True)
    return ShowAccess(show, None, None, via_admin=False)


def readable_show(ctx: Ctx, show_id: str, user: User, action: ShowAction = "show:read") -> ShowAccess:
    access = show_access(ctx, show_id, user)
    if access.role is None:
        raise Forbidden()
    return access.require(action)


def editable_show(ctx: Ctx, show_id: str, user: User, action: ShowAction) -> ShowAccess:
    return readable_show(ctx, show_id, user, action).require_open()
