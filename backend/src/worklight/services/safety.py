"""Emergency contacts, medical notes, and approved pickups for minors.

A person's safety info is theirs, across every show. Staff of a show they've joined can read their
contacts (and a minor's pickup list) while that show is active; only staff whose medicalAccess switch is
on can open medical notes. Every read lands in the person's "Who has looked" log.
"""

from typing import Annotated

from pydantic import Field

from worklight.ids import now_epoch, now_iso
from worklight.models import (
    ApprovedPickup,
    EmergencyContact,
    MedicalNotes,
    MemberMedical,
    MemberSafety,
    Membership,
    Model,
    SafetyAccess,
    SafetyAccessView,
    SafetyInfo,
    SafetyView,
    ShowSafety,
    User,
)
from worklight.safety_store import SafetyStore
from worklight.services.base import (
    Conflict,
    Ctx,
    Forbidden,
    NotFound,
    ShowAccess,
    optional_text,
    readable_show,
    text,
)
from worklight.services.schedule import _load_cast, content_of
from worklight.services.tech import ATTENDANCE_TYPES, local_now

LOG_TTL_SECONDS = 365 * 24 * 60 * 60


def _db(ctx: Ctx) -> SafetyStore:
    if ctx.safety is None:
        raise RuntimeError("Safety info isn't available here")
    return ctx.safety


# ---- The person's own info ------------------------------------------------------------------------


class ContactBody(Model):
    name: Annotated[str, text(100)]
    relationship: optional_text(60) = None  # type: ignore[valid-type]
    phone: Annotated[str, text(40)]
    alt_phone: optional_text(40) = None  # type: ignore[valid-type]
    guardian: bool = False


class PickupBody(Model):
    name: Annotated[str, text(100)]
    note: optional_text(200) = None  # type: ignore[valid-type]


class MedicalBody(Model):
    allergies: optional_text(1000) = None  # type: ignore[valid-type]
    conditions: optional_text(1000) = None  # type: ignore[valid-type]
    medications: optional_text(1000) = None  # type: ignore[valid-type]
    other: optional_text(1000) = None  # type: ignore[valid-type]


class SafetyBody(Model):
    minor: bool = False
    contacts: list[ContactBody] = Field(default=[], max_length=5)
    pickups: list[PickupBody] = Field(default=[], max_length=10)
    medical: MedicalBody | None = None


def get_mine(ctx: Ctx, user: User) -> SafetyInfo:
    return _db(ctx).get(user.user_id) or SafetyInfo(user_id=user.user_id, updated_at="")


def put_mine(ctx: Ctx, user: User, body: SafetyBody) -> SafetyInfo:
    medical = MedicalNotes.model_validate(body.medical.model_dump()) if body.medical else None
    info = SafetyInfo(
        user_id=user.user_id,
        minor=body.minor,
        contacts=[EmergencyContact.model_validate(c.model_dump()) for c in body.contacts],
        # A pickup list only means something for a minor.
        pickups=[ApprovedPickup.model_validate(p.model_dump()) for p in body.pickups] if body.minor else [],
        medical=None if medical is None or medical.is_empty() else medical,
        updated_at=now_iso(),
    )
    _db(ctx).put(info)
    return info


def delete_mine(ctx: Ctx, user: User) -> None:
    _db(ctx).delete(user.user_id)


def my_views(ctx: Ctx, user: User) -> list[SafetyAccessView]:
    return [
        SafetyAccessView(
            viewer_name=v.viewer_name,
            viewer_title=v.viewer_title,
            show_name=v.show_name,
            view=v.view,
            at=v.at,
        )
        for v in _db(ctx).list_views(user.user_id)
    ]


# ---- Staff ----------------------------------------------------------------------------------------


def _staff_access(ctx: Ctx, user: User, show_id: str) -> ShowAccess:
    access = readable_show(ctx, show_id, user, "safety:read")
    if access.show.status != "active":
        raise Conflict("Safety info is only shown while a show is active")
    return access


def _log(ctx: Ctx, access: ShowAccess, viewer: User, user_ids: list[str], view: SafetyView) -> None:
    at = now_iso()
    title = access.membership.title if access.membership else "Company admin"
    _db(ctx).log_views(
        [
            SafetyAccess(
                user_id=uid,
                viewer_id=viewer.user_id,
                viewer_name=viewer.name or viewer.email,
                viewer_title=title,
                show_id=access.show.show_id,
                show_name=access.show.name,
                view=view,
                at=at,
                expires_at=now_epoch() + LOG_TTL_SECONDS,
            )
            for uid in user_ids
            if uid != viewer.user_id
        ]
    )


class TonightPickup(Model):
    user_id: str
    # When the minor's call ends tonight, HH:MM in the show's timezone.
    ends: str


class ShowSafetyPage(ShowSafety):
    # Minors called tonight, latest finish first.
    tonight: list[TonightPickup] = []
    tonight_date: str


def _joined(members: list[Membership]) -> list[Membership]:
    # People who were invited but haven't joined haven't agreed to share anything with this show.
    return [m for m in members if m.status == "joined"]


def show_safety(ctx: Ctx, user: User, show_id: str) -> ShowSafetyPage:
    access = _staff_access(ctx, user, show_id)
    members = _joined(ctx.store.list_members(show_id))
    users = {u.user_id: u for u in ctx.store.get_users(m.user_id for m in members)}
    infos = _db(ctx).get_many(m.user_id for m in members)
    rows = []
    for m in members:
        info = infos.get(m.user_id)
        u = users.get(m.user_id)
        rows.append(
            MemberSafety(
                user_id=m.user_id,
                name=u.name if u else None,
                role=m.role,
                title=m.title,
                minor=bool(info and info.minor),
                contacts=info.contacts if info else [],
                pickups=info.pickups if info and info.minor else [],
                has_medical=bool(info and info.medical),
            )
        )
    rows.sort(key=lambda r: (r.name or "").lower())
    _log(ctx, access, user, [m.user_id for m in members if m.user_id in infos], "contacts")

    today, _ = local_now(access.show.timezone)
    minors = {r.user_id for r in rows if r.minor}
    ends: dict[str, str] = {}
    if minors:
        cast, _ = _load_cast(ctx, access.show)
        for call in ctx.store.list_calls(show_id, today, today):
            content = call.published or (content_of(call) if call.type in ATTENDANCE_TYPES else None)
            if not content:
                continue
            for uid, entry in cast.called(content).items():
                if uid in minors:
                    ends[uid] = max(ends.get(uid, ""), entry.end)
    return ShowSafetyPage(
        members=rows,
        medical_access=bool(access.membership and access.membership.medical_access),
        tonight=[
            TonightPickup(user_id=uid, ends=end)
            for uid, end in sorted(ends.items(), key=lambda kv: kv[1], reverse=True)
        ],
        tonight_date=today,
    )


def member_medical(ctx: Ctx, user: User, show_id: str, member_id: str) -> MemberMedical:
    access = _staff_access(ctx, user, show_id)
    if not (access.membership and access.membership.medical_access):
        raise Forbidden("You don't have access to medical notes on this show")
    member = ctx.store.get_membership(show_id, member_id)
    if not member or member.status != "joined":
        raise NotFound("That person isn't in this show")
    info = _db(ctx).get(member_id)
    who = ctx.store.get_user(member_id)
    if info and info.medical:
        _log(ctx, access, user, [member_id], "medical")
    return MemberMedical(
        user_id=member_id, name=who.name if who else None, medical=info.medical if info else None
    )
