from typing import Annotated

from pydantic import Field, model_validator

from worklight.ids import new_id, new_token, now_epoch, now_iso
from worklight.mailer import conflicts_reminder_email, invite_email
from worklight.models import (
    Invite,
    InviteAccepted,
    InvitePreview,
    InviteSent,
    Member,
    Membership,
    Model,
    RehearsalSlot,
    Show,
    ShowRole,
    ShowView,
    User,
)
from worklight.services.base import (
    Conflict,
    Ctx,
    Email,
    Forbidden,
    Invalid,
    IsoDate,
    NotFound,
    OptionalDate,
    Time,
    Timezone,
    editable_show,
    maybe_text,
    optional_text,
    readable_show,
    show_access,
    text,
    user_for_email,
)
from worklight.store import Store

INVITE_TTL_SECONDS = 30 * 24 * 60 * 60


class SlotBody(Model):
    weekday: int = Field(ge=0, le=6)
    start: Time
    end: Time

    @model_validator(mode="after")
    def _ends_after_start(self) -> "SlotBody":
        if self.end <= self.start:
            raise ValueError("must each end after they start")
        return self


class ShowSettings(Model):
    """Fields shared by creating and editing a show. Every field is optional on edit."""

    venue: optional_text(200) = None  # type: ignore[valid-type]
    address: optional_text(200) = None  # type: ignore[valid-type]
    slots: list[SlotBody] | None = Field(default=None, max_length=7)
    skipped_dates: list[IsoDate] | None = Field(default=None, max_length=400)
    off_book_date: OptionalDate = None
    tech_start: OptionalDate = None
    opening_date: OptionalDate = None
    minutes_per_page: float | None = Field(default=None, gt=0, le=120)
    conflict_deadline: OptionalDate = None


class CreateShowBody(ShowSettings):
    name: Annotated[str, text(120)]
    timezone: Timezone
    start_date: IsoDate
    end_date: IsoDate
    creator_title: optional_text(60) = None  # type: ignore[valid-type]


class UpdateShowBody(ShowSettings):
    name: maybe_text(120) = None  # type: ignore[valid-type]
    timezone: Timezone | None = None
    start_date: IsoDate | None = None
    end_date: IsoDate | None = None


def _check_dates(show: Show) -> None:
    if show.end_date < show.start_date:
        raise Invalid("endDate must be on or after startDate")
    for name, value in (
        ("techStart", show.tech_start),
        ("openingDate", show.opening_date),
        ("offBookDate", show.off_book_date),
    ):
        if value and not show.start_date <= value <= show.end_date:
            raise Invalid(f"{name} must be between the first rehearsal and closing")
    if show.tech_start and show.opening_date and show.opening_date < show.tech_start:
        raise Invalid("openingDate must be on or after techStart")
    if len({s.weekday for s in show.slots}) != len(show.slots):
        raise Invalid("slots can only have one rehearsal per weekday")


def _settings(body: ShowSettings) -> dict[str, object]:
    """The fields the caller actually sent, ready for model_copy."""
    out: dict[str, object] = {}
    for name in body.model_fields_set:
        value = getattr(body, name)
        if name == "slots":
            value = [RehearsalSlot(weekday=s.weekday, start=s.start, end=s.end) for s in value or []]
            value.sort(key=lambda s: s.weekday)
        elif name == "skipped_dates":
            value = sorted(set(value or []))
        elif name == "minutes_per_page" and value is None:
            continue
        out[name] = value
    return out


def create_show(ctx: Ctx, user: User, theater_id: str, body: CreateShowBody) -> Show:
    if not ctx.store.get_theater(theater_id):
        raise NotFound("Theater not found")
    if not ctx.store.is_theater_admin(theater_id, user.user_id):
        raise Forbidden()
    fields = _settings(body)
    for name in ("name", "timezone", "start_date", "end_date", "creator_title"):
        fields.pop(name, None)
    show = Show(
        show_id=new_id(),
        theater_id=theater_id,
        name=body.name,
        timezone=body.timezone,
        start_date=body.start_date,
        end_date=body.end_date,
        created_at=now_iso(),
    ).model_copy(update=fields)
    _check_dates(show)
    creator = Membership(
        show_id=show.show_id,
        theater_id=theater_id,
        user_id=user.user_id,
        role="staff",
        title=body.creator_title or "Director",
        department="Production",
        joined_at=now_iso(),
    )
    ctx.store.create_show(show, creator)
    return show


def get_show(ctx: Ctx, user: User, show_id: str) -> ShowView:
    access = readable_show(ctx, show_id, user)
    theater = ctx.store.get_theater(access.show.theater_id)
    assert access.role is not None
    return ShowView(
        show=access.show,
        theater_name=theater.name if theater else "",
        role=access.role,
        title=access.membership.title if access.membership else "Company admin",
        via_admin=access.via_admin,
    )


def update_show(ctx: Ctx, user: User, show_id: str, body: UpdateShowBody) -> Show:
    access = editable_show(ctx, show_id, user, "show:edit")
    fields = {k: v for k, v in _settings(body).items() if v is not None or k not in _REQUIRED}
    show = access.show.model_copy(update=fields)
    _check_dates(show)
    ctx.store.put_show(show)
    return show


_REQUIRED = {"name", "timezone", "start_date", "end_date"}


def set_archived(ctx: Ctx, user: User, show_id: str, archived: bool) -> Show:
    access = readable_show(ctx, show_id, user, "show:archive")
    show = access.show.model_copy(
        update={
            "status": "archived" if archived else "active",
            "archived_at": now_iso() if archived else None,
        }
    )
    ctx.store.put_show(show)
    return show


# ---- People ---------------------------------------------------------------------------------------


def _member_view(m: Membership, user: User | None, sees_email: bool) -> Member:
    return Member(
        user_id=m.user_id,
        name=user.name if user else None,
        email=user.email if sees_email and user else None,
        role=m.role,
        title=m.title,
        department=m.department,
        status=m.status,
        conflicts_submitted_at=m.conflicts_submitted_at,
    )


def list_members(ctx: Ctx, user: User, show_id: str) -> list[Member]:
    access = readable_show(ctx, show_id, user, "members:read")
    members = ctx.store.list_members(show_id)
    users = {u.user_id: u for u in ctx.store.get_users(m.user_id for m in members)}
    sees_email = access.can("members:invite")
    return [_member_view(m, users.get(m.user_id), sees_email) for m in members]


class CreateInviteBody(Model):
    email: Email
    name: optional_text(100) = None  # type: ignore[valid-type]
    role: ShowRole = "cast"
    title: optional_text(60) = None  # type: ignore[valid-type]
    department: optional_text(60) = None  # type: ignore[valid-type]
    # Cast the new person in these parts straight away.
    character_ids: list[str] = Field(default=[], max_length=20)


def _send_invite(ctx: Ctx, sender: User, show: Show, membership: Membership, invitee: User) -> Invite:
    if membership.invite_token:
        ctx.store.delete_invite(membership.invite_token)
    invite = Invite(
        token=new_token(),
        show_id=show.show_id,
        theater_id=show.theater_id,
        user_id=invitee.user_id,
        email=invitee.email,
        invited_by=sender.user_id,
        created_at=now_iso(),
        expires_at=now_epoch() + INVITE_TTL_SECONDS,
    )
    ctx.store.put_invite(invite)
    ctx.store.put_membership(
        membership.model_copy(update={"invite_token": invite.token, "invited_at": invite.created_at})
    )
    ctx.mailer.send(
        invite_email(
            invitee.email,
            show.name,
            sender.name or sender.email,
            ctx.link(f"/join/{invite.token}"),
            invitee.name,
        )
    )
    return invite


def create_invite(ctx: Ctx, user: User, show_id: str, body: CreateInviteBody) -> InviteSent:
    access = editable_show(ctx, show_id, user, "members:invite")
    show = access.show
    invitee = user_for_email(ctx, body.email, body.name)
    if body.name and not invitee.name:
        ctx.store.update_user_name(invitee.user_id, body.name)
        invitee = invitee.model_copy(update={"name": body.name})
    existing = ctx.store.get_membership(show_id, invitee.user_id)
    if existing and existing.status == "joined":
        raise Conflict(f"{invitee.name or invitee.email} is already in this show")
    membership = Membership(
        show_id=show_id,
        theater_id=show.theater_id,
        user_id=invitee.user_id,
        role=body.role,
        title=body.title,
        department=body.department,
        status="invited",
        invite_token=existing.invite_token if existing else None,
    )
    invite = _send_invite(ctx, user, show, membership, invitee)
    if body.character_ids:
        from worklight.services.breakdown import cast_in

        cast_in(ctx, show_id, invitee.user_id, body.character_ids)
    return InviteSent(
        user_id=invitee.user_id,
        email=invitee.email,
        role=membership.role,
        title=membership.title,
        expires_at=invite.expires_at,
    )


class UpdateMemberBody(Model):
    role: ShowRole | None = None
    title: optional_text(60) = None  # type: ignore[valid-type]
    department: optional_text(60) = None  # type: ignore[valid-type]


def update_member(ctx: Ctx, user: User, show_id: str, member_id: str, body: UpdateMemberBody) -> Member:
    editable_show(ctx, show_id, user, "members:invite")
    membership = ctx.store.get_membership(show_id, member_id)
    if not membership:
        raise NotFound("That person isn't in this show")
    fields = {k: getattr(body, k) for k in body.model_fields_set if not (k == "role" and body.role is None)}
    if membership.user_id == user.user_id and fields.get("role", "staff") != "staff":
        raise Invalid("You can't remove your own staff access")
    membership = membership.model_copy(update=fields)
    ctx.store.put_membership(membership)
    return _member_view(membership, ctx.store.get_user(member_id), True)


def remove_member(ctx: Ctx, user: User, show_id: str, member_id: str) -> None:
    editable_show(ctx, show_id, user, "members:invite")
    membership = ctx.store.get_membership(show_id, member_id)
    if not membership:
        raise NotFound("That person isn't in this show")
    if member_id == user.user_id:
        raise Invalid("You can't remove yourself from a show")
    from worklight.services.breakdown import uncast_everywhere

    uncast_everywhere(ctx, show_id, member_id)
    if membership.invite_token:
        ctx.store.delete_invite(membership.invite_token)
    ctx.store.delete_membership(show_id, member_id)


class RemindBody(Model):
    # Leave out to remind everyone who hasn't sent their conflicts.
    user_ids: list[str] | None = Field(default=None, max_length=200)


class Reminded(Model):
    invites_resent: int
    conflict_reminders: int


def remind(ctx: Ctx, user: User, show_id: str, body: RemindBody) -> Reminded:
    """Resends invites to people who haven't joined, and nudges people who joined but haven't sent
    their conflicts."""
    access = editable_show(ctx, show_id, user, "members:invite")
    show = access.show
    members = [m for m in ctx.store.list_members(show_id) if not m.conflicts_submitted_at]
    if body.user_ids is not None:
        wanted = set(body.user_ids)
        members = [m for m in members if m.user_id in wanted]
    users = {u.user_id: u for u in ctx.store.get_users(m.user_id for m in members)}
    resent = nudged = 0
    for m in members:
        person = users.get(m.user_id)
        if not person or m.user_id == user.user_id:
            continue
        if m.status == "invited":
            _send_invite(ctx, user, show, m, person)
            resent += 1
        else:
            ctx.mailer.send(
                conflicts_reminder_email(
                    person.email,
                    show.name,
                    user.name or user.email,
                    ctx.link(f"/shows/{show_id}/conflicts"),
                    show.conflict_deadline,
                )
            )
            nudged += 1
    return Reminded(invites_resent=resent, conflict_reminders=nudged)


# ---- Joining --------------------------------------------------------------------------------------


def _live_invite(ctx: Ctx, token: str) -> Invite:
    invite = ctx.store.get_invite(token)
    # DynamoDB TTL deletes lazily, so expired items can still be read for a while.
    if not invite or invite.expires_at < now_epoch():
        raise NotFound("This invite has expired or was already used")
    return invite


def preview_invite(ctx: Ctx, token: str) -> InvitePreview:
    """Public: what an invite link is for, so the sign-in page can say so."""
    invite = _live_invite(ctx, token)
    show = ctx.store.get_show(invite.show_id)
    membership = ctx.store.get_membership(invite.show_id, invite.user_id)
    if not show or not membership:
        raise NotFound("This invite has expired or was already used")
    theater = ctx.store.get_theater(show.theater_id)
    inviter = ctx.store.get_user(invite.invited_by)
    from worklight.services.breakdown import parts_for

    parts = parts_for(ctx, show.show_id, invite.user_id)
    return InvitePreview(
        email=invite.email,
        show_name=show.name,
        theater_name=theater.name if theater else "",
        inviter_name=(inviter.name or inviter.email) if inviter else "Your director",
        role=membership.role,
        part=", ".join(parts) if parts else membership.title,
    )


def accept_invite(ctx: Ctx, user: User, token: str) -> InviteAccepted:
    invite = _live_invite(ctx, token)
    if invite.user_id != user.user_id:
        raise Forbidden(f"This invite was sent to {invite.email}. Sign in with that address to accept it.")
    membership = ctx.store.get_membership(invite.show_id, user.user_id)
    if not membership:
        raise NotFound("This invite has expired or was already used")
    ctx.store.put_membership(
        membership.model_copy(update={"status": "joined", "invite_token": None, "joined_at": now_iso()})
    )
    ctx.store.delete_invite(token)
    return InviteAccepted(show_id=invite.show_id, role=membership.role)


def join_show(ctx: Ctx, user: User, show_id: str) -> InviteAccepted:
    """Marks an invited person as joined when they reach the show some other way (e.g. a later sign-in)."""
    access = show_access(ctx, show_id, user)
    membership = access.membership
    if not membership:
        raise Forbidden()
    if membership.status == "invited":
        if membership.invite_token:
            ctx.store.delete_invite(membership.invite_token)
        membership = membership.model_copy(
            update={"status": "joined", "invite_token": None, "joined_at": now_iso()}
        )
        ctx.store.put_membership(membership)
    return InviteAccepted(show_id=show_id, role=membership.role)


def invite_sign_in_ok(store: Store, email: str, token: str) -> bool:
    """Cognito asks this when someone opens an invite link: the link signs in the invited address."""
    invite = store.get_invite(token)
    return bool(invite and invite.expires_at >= now_epoch() and invite.email == email.strip().lower())
