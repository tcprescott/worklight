"""The Worklight HTTP API. One FastAPI app; Mangum adapts it to API Gateway in handlers/api.py."""

import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BeforeValidator, StringConstraints, model_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from call_time import keys
from call_time.ids import new_id, new_token, now_epoch, now_iso
from call_time.mailer import Mailer, invite_email
from call_time.models import (
    Invite,
    InviteAccepted,
    InviteSent,
    Me,
    Member,
    Membership,
    Model,
    MyShow,
    MyTheater,
    Show,
    ShowRole,
    ShowView,
    Theater,
    User,
)
from call_time.roles import can_on_show
from call_time.store import Store

log = logging.getLogger(__name__)

INVITE_TTL_SECONDS = 30 * 24 * 60 * 60


@dataclass(frozen=True)
class AppDeps:
    store: Store
    mailer: Mailer
    # Public site origin, e.g. https://calltime.example.org. Used in emailed links.
    app_url: str


# ---- Request bodies ---------------------------------------------------------------------------


def _text(max_length: int) -> Any:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


def _blank_to_none(value: object) -> object:
    return None if value == "" else value


def _check_date(value: str) -> str:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("must be a date like 2026-11-02")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("must be a date like 2026-11-02") from None
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


class UpdateMeBody(Model):
    name: Annotated[str, _text(100)]


class CreateTheaterBody(Model):
    name: Annotated[str, _text(120)]


class CreateShowBody(Model):
    name: Annotated[str, _text(120)]
    venue: Annotated[str | None, BeforeValidator(_blank_to_none), _text(200)] = None
    timezone: Annotated[str, AfterValidator(_check_timezone)]
    start_date: IsoDate
    end_date: IsoDate
    creator_title: Annotated[str | None, BeforeValidator(_blank_to_none), _text(60)] = None

    @model_validator(mode="after")
    def _dates_in_order(self) -> "CreateShowBody":
        if self.end_date < self.start_date:
            raise ValueError("endDate must be on or after startDate")
        return self


class CreateInviteBody(Model):
    email: Annotated[str, AfterValidator(_check_email)]
    role: ShowRole = "cast"
    title: Annotated[str | None, BeforeValidator(_blank_to_none), _text(60)] = None


# ---- App ----------------------------------------------------------------------------------------


def get_claims(request: Request) -> dict[str, Any]:
    """JWT claims API Gateway verified. Mangum passes the original Lambda event in the ASGI scope."""
    event = request.scope.get("aws.event") or {}
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return claims if isinstance(claims, dict) else {}


_ERRORS = {404: "Not found", 405: "Method not allowed"}


def _validation_message(exc: RequestValidationError) -> str:
    first = exc.errors()[0]
    kind, loc, msg = first.get("type"), tuple(first.get("loc", ())), str(first.get("msg", "is invalid"))
    if kind == "json_invalid" or (
        kind in ("missing", "model_attributes_type", "dict_type") and loc == ("body",)
    ):
        return "Request body must be a JSON object"
    field = next((str(p) for p in reversed(loc) if isinstance(p, str)), "body")
    if kind == "value_error":
        msg = msg.removeprefix("Value error, ")
        # Cross-field checks run on the whole body and already name their fields.
        return msg if loc == ("body",) else f"{field} {msg}"
    if kind in ("missing", "string_too_short"):
        return f"{field} is required"
    if kind == "string_too_long":
        return f"{field} is too long"
    if kind == "literal_error" and field == "role":
        return "role must be staff, cast or crew"
    return f"{field}: {msg}"


def create_app(deps: AppDeps) -> FastAPI:
    store, mailer, app_url = deps.store, deps.mailer, deps.app_url

    app = FastAPI(
        title="Worklight API", version="1", docs_url=None, redoc_url=None, openapi_url="/api/openapi.json"
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) and exc.status_code not in _ERRORS else None
        return JSONResponse(
            {"error": message or _ERRORS.get(exc.status_code, "Request failed")},
            status_code=exc.status_code,
            headers={"cache-control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": _validation_message(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse({"error": "Something went wrong"}, status_code=500)

    @app.middleware("http")
    async def no_store(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["cache-control"] = "no-store"
        return response

    def current_user(claims: Annotated[dict[str, Any], Depends(get_claims)]) -> User:
        """Maps the verified email in the ID token to a Worklight user, creating one on first sign-in."""
        raw_email = claims.get("email")
        verified = claims.get("email_verified") in (True, "true")
        if not isinstance(raw_email, str) or not raw_email or not verified:
            raise HTTPException(401, "Sign in required")
        email = keys.normalize_email(raw_email)
        existing_id = store.get_user_id_by_email(email)
        if existing_id and (existing := store.get_user(existing_id)):
            return existing
        user = User(user_id=new_id(), email=email, created_at=now_iso())
        user_id = store.create_user(user)
        return user if user_id == user.user_id else (store.get_user(user_id) or user)

    CurrentUser = Annotated[User, Depends(current_user)]

    def show_access(show_id: str, user_id: str) -> tuple[Show, ShowRole | None, Membership | None]:
        """The caller's role on a show. Theater admins get staff rights on every show in their theater."""
        show = store.get_show(show_id)
        if not show:
            raise HTTPException(404, "Show not found")
        membership = store.get_membership(show_id, user_id)
        if membership:
            return show, membership.role, membership
        if store.is_theater_admin(show.theater_id, user_id):
            return show, "staff", None
        return show, None, None

    def forbidden() -> HTTPException:
        return HTTPException(403, "You don't have access to this")

    @app.get("/api/me", response_model=Me, response_model_exclude_none=True)
    def get_me(user: CurrentUser) -> Me:
        theater_ids = store.list_admin_theater_ids(user.user_id)
        memberships = store.list_memberships(user.user_id)
        theaters = [t for t in (store.get_theater(tid) for tid in theater_ids) if t]
        by_id = {s.show_id: s for s in store.get_shows((m.theater_id, m.show_id) for m in memberships)}
        shows = [
            MyShow(show=by_id[m.show_id], role=m.role, title=m.title)
            for m in memberships
            if m.show_id in by_id
        ]
        shows.sort(key=lambda s: s.show.start_date)
        return Me(user=user, theaters=[MyTheater(theater=t, role="admin") for t in theaters], shows=shows)

    @app.patch("/api/me", response_model=User, response_model_exclude_none=True)
    def update_me(user: CurrentUser, body: UpdateMeBody) -> User:
        store.update_user_name(user.user_id, body.name)
        return user.model_copy(update={"name": body.name})

    @app.post("/api/theaters", status_code=201, response_model=Theater, response_model_exclude_none=True)
    def create_theater(user: CurrentUser, body: CreateTheaterBody) -> Theater:
        theater = Theater(theater_id=new_id(), name=body.name, plan="free", created_at=now_iso())
        store.create_theater(theater, user.user_id)
        return theater

    @app.post(
        "/api/theaters/{theater_id}/shows",
        status_code=201,
        response_model=Show,
        response_model_exclude_none=True,
    )
    def create_show(theater_id: str, user: CurrentUser, body: CreateShowBody) -> Show:
        if not store.get_theater(theater_id):
            raise HTTPException(404, "Theater not found")
        if not store.is_theater_admin(theater_id, user.user_id):
            raise forbidden()
        show = Show(
            show_id=new_id(),
            theater_id=theater_id,
            name=body.name,
            venue=body.venue,
            timezone=body.timezone,
            start_date=body.start_date,
            end_date=body.end_date,
            created_at=now_iso(),
        )
        creator = Membership(
            show_id=show.show_id,
            theater_id=theater_id,
            user_id=user.user_id,
            role="staff",
            title=body.creator_title or "Director",
            joined_at=now_iso(),
        )
        store.create_show(show, creator)
        return show

    @app.get("/api/shows/{show_id}", response_model=ShowView, response_model_exclude_none=True)
    def get_show(show_id: str, user: CurrentUser) -> ShowView:
        show, role, membership = show_access(show_id, user.user_id)
        if role is None or not can_on_show(role, "show:read"):
            raise forbidden()
        return ShowView(show=show, role=role, title=membership.title if membership else None)

    @app.get("/api/shows/{show_id}/members", response_model=list[Member], response_model_exclude_none=True)
    def list_members(show_id: str, user: CurrentUser) -> list[Member]:
        _, role, _ = show_access(show_id, user.user_id)
        if not can_on_show(role, "members:read"):
            raise forbidden()
        members = store.list_members(show_id)
        users = {u.user_id: u for u in store.get_users(m.user_id for m in members)}
        sees_email = can_on_show(role, "members:invite")
        return [
            Member(
                user_id=m.user_id,
                name=users[m.user_id].name if m.user_id in users else None,
                email=users[m.user_id].email if sees_email and m.user_id in users else None,
                role=m.role,
                title=m.title,
            )
            for m in members
        ]

    @app.post(
        "/api/shows/{show_id}/invites",
        status_code=201,
        response_model=InviteSent,
        response_model_exclude_none=True,
    )
    def create_invite(show_id: str, user: CurrentUser, body: CreateInviteBody) -> InviteSent:
        show, role, _ = show_access(show_id, user.user_id)
        if not can_on_show(role, "members:invite"):
            raise forbidden()
        invite = Invite(
            token=new_token(),
            show_id=show.show_id,
            theater_id=show.theater_id,
            email=body.email,
            role=body.role,
            title=body.title,
            invited_by=user.user_id,
            created_at=now_iso(),
            expires_at=now_epoch() + INVITE_TTL_SECONDS,
        )
        store.put_invite(invite)
        url = f"{app_url.rstrip('/')}/invite/{invite.token}"
        mailer.send(invite_email(invite.email, show.name, user.name or user.email, url))
        return InviteSent(
            email=invite.email, role=invite.role, title=invite.title, expires_at=invite.expires_at
        )

    @app.post("/api/invites/{token}/accept", response_model=InviteAccepted, response_model_exclude_none=True)
    def accept_invite(token: str, user: CurrentUser) -> InviteAccepted:
        invite = store.get_invite(token)
        # DynamoDB TTL deletes lazily, so expired items can still be read for a while.
        if not invite or invite.expires_at < now_epoch():
            raise HTTPException(404, "This invite has expired or was already used")
        if invite.email != user.email:
            raise HTTPException(
                403, f"This invite was sent to {invite.email}. Sign in with that address to accept it."
            )
        existing = store.get_membership(invite.show_id, user.user_id)
        membership = Membership(
            show_id=invite.show_id,
            theater_id=invite.theater_id,
            user_id=user.user_id,
            # Accepting a second invite never downgrades staff.
            role="staff" if existing and existing.role == "staff" else invite.role,
            title=invite.title or (existing.title if existing else None),
            joined_at=existing.joined_at if existing else now_iso(),
        )
        store.accept_invite(invite, membership)
        return InviteAccepted(show_id=invite.show_id, role=membership.role)

    return app
