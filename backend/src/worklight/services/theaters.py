from typing import Annotated

from worklight.ids import new_id, now_iso
from worklight.mailer import admin_added_email
from worklight.models import Admin, Member, Model, ShowSummary, Theater, TheaterView, User
from worklight.services.base import (
    Ctx,
    Email,
    Forbidden,
    Invalid,
    NotFound,
    optional_text,
    text,
    user_for_email,
)


class CreateTheaterBody(Model):
    name: Annotated[str, text(120)]
    # The creator's role in the company, e.g. "Artistic director".
    title: optional_text(60) = None  # type: ignore[valid-type]


def create_theater(ctx: Ctx, user: User, body: CreateTheaterBody) -> Theater:
    theater = Theater(theater_id=new_id(), name=body.name, plan="free", created_at=now_iso())
    ctx.store.create_theater(theater, user.user_id, body.title)
    return theater


def _admin_theater(ctx: Ctx, user: User, theater_id: str) -> Theater:
    theater = ctx.store.get_theater(theater_id)
    if not theater:
        raise NotFound("Theater not found")
    if not ctx.store.is_theater_admin(theater_id, user.user_id):
        raise Forbidden()
    return theater


def _admins(ctx: Ctx, theater_id: str) -> list[Admin]:
    pairs = ctx.store.list_admins(theater_id)
    users = {u.user_id: u for u in ctx.store.get_users(uid for uid, _ in pairs)}
    return [
        Admin(user_id=uid, name=users[uid].name, email=users[uid].email, title=title)
        for uid, title in pairs
        if uid in users
    ]


def get_theater(ctx: Ctx, user: User, theater_id: str) -> TheaterView:
    """Company home: every show with its staff and head counts, plus the admins."""
    theater = _admin_theater(ctx, user, theater_id)
    shows = sorted(ctx.store.list_theater_shows(theater_id), key=lambda s: s.start_date)
    members_by_show = {s.show_id: ctx.store.list_members(s.show_id) for s in shows}
    staff_ids = {m.user_id for ms in members_by_show.values() for m in ms if m.role == "staff"}
    users = {u.user_id: u for u in ctx.store.get_users(staff_ids)}
    summaries = []
    for show in shows:
        members = members_by_show[show.show_id]
        staff = [
            Member(
                user_id=m.user_id,
                name=users[m.user_id].name if m.user_id in users else None,
                email=users[m.user_id].email if m.user_id in users else None,
                role=m.role,
                title=m.title,
                department=m.department,
                status=m.status,
                conflicts_submitted_at=m.conflicts_submitted_at,
            )
            for m in members
            if m.role == "staff"
        ]
        summaries.append(
            ShowSummary(
                show=show,
                staff=staff,
                cast_count=sum(m.role == "cast" for m in members),
                crew_count=sum(m.role == "crew" for m in members),
                waiting_count=sum(m.role != "staff" and not m.conflicts_submitted_at for m in members),
            )
        )
    return TheaterView(theater=theater, admins=_admins(ctx, theater_id), shows=summaries)


class AddAdminBody(Model):
    email: Email
    name: optional_text(100) = None  # type: ignore[valid-type]
    title: optional_text(60) = None  # type: ignore[valid-type]


def add_admin(ctx: Ctx, user: User, theater_id: str, body: AddAdminBody) -> list[Admin]:
    theater = _admin_theater(ctx, user, theater_id)
    person = user_for_email(ctx, body.email, body.name)
    if body.name and not person.name:
        ctx.store.update_user_name(person.user_id, body.name)
    if not ctx.store.is_theater_admin(theater_id, person.user_id):
        ctx.store.put_admin(theater_id, person.user_id, body.title)
        ctx.mailer.send(admin_added_email(person.email, theater.name, user.name or user.email, ctx.link("/")))
    return _admins(ctx, theater_id)


def remove_admin(ctx: Ctx, user: User, theater_id: str, admin_id: str) -> list[Admin]:
    _admin_theater(ctx, user, theater_id)
    admins = ctx.store.list_admins(theater_id)
    if admin_id not in {uid for uid, _ in admins}:
        raise NotFound("That person isn't an admin")
    if len(admins) == 1:
        raise Invalid("A company needs at least one admin")
    ctx.store.delete_admin(theater_id, admin_id)
    return _admins(ctx, theater_id)
