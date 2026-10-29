"""The callboard: notices from staff to everyone, the cast, or the crew, with who has read them."""

from typing import Annotated

from pydantic import Field

from worklight import mailer
from worklight.ids import new_id, now_iso
from worklight.models import Membership, Model, Notice, NoticeAudience, NoticeRead, User
from worklight.services.base import (
    Ctx,
    NotFound,
    editable_show,
    maybe_text,
    readable_show,
    text,
)


def _reaches(audience: NoticeAudience, m: Membership) -> bool:
    """Staff see every notice; cast and crew see everyone's and their own group's."""
    return audience == "everyone" or m.role == "staff" or m.role == audience


class NoticeView(Notice):
    author_name: str | None = None
    # Whether the person looking has read it.
    read: bool = False
    # Staff only: how many of the people it's for have read it.
    read_count: int | None = None
    audience_count: int | None = None


class Callboard(Model):
    notices: list[NoticeView]
    unread: int
    can_post: bool


def get_callboard(ctx: Ctx, user: User, show_id: str) -> Callboard:
    access = readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    staff = access.can("callboard:post")
    me = access.membership
    authors = {u.user_id: u.name for u in ctx.store.get_users({n.author_id for n in part.notices})}
    reads: dict[str, set[str]] = {}
    for r in part.reads:
        reads.setdefault(r.notice_id, set()).add(r.user_id)
    out = []
    for n in part.notices:
        if not staff and not (me and _reaches(n.audience, me)):
            continue
        view = NoticeView(
            **n.model_dump(),
            author_name=authors.get(n.author_id),
            read=user.user_id in reads.get(n.notice_id, set()) or n.author_id == user.user_id,
        )
        if staff:
            # Read counts leave out the author, who has read it by definition.
            audience = [m for m in part.members if _reaches(n.audience, m) and m.user_id != n.author_id]
            view.audience_count = len(audience)
            view.read_count = sum(1 for m in audience if m.user_id in reads.get(n.notice_id, set()))
        out.append(view)
    pinned = [n for n in out if n.pinned]
    rest = sorted((n for n in out if not n.pinned), key=lambda n: n.created_at, reverse=True)
    pinned.sort(key=lambda n: n.created_at, reverse=True)
    notices = pinned + rest
    return Callboard(
        notices=notices,
        unread=sum(1 for n in notices if not n.read),
        can_post=staff and access.show.status != "archived",
    )


class PostNoticeBody(Model):
    title: Annotated[str, text(120)]
    body: Annotated[str, text(4000)]
    audience: NoticeAudience = "everyone"
    pinned: bool = False
    # Email it to the people it's for (those who haven't turned notice emails off).
    email: bool = True


class UpdateNoticeBody(Model):
    title: maybe_text(120) = None  # type: ignore[valid-type]
    body: maybe_text(4000) = None  # type: ignore[valid-type]
    audience: NoticeAudience | None = None
    pinned: bool | None = None


def post_notice(ctx: Ctx, user: User, show_id: str, body: PostNoticeBody) -> Notice:
    show = editable_show(ctx, show_id, user, "callboard:post").show
    stamp = now_iso()
    notice = Notice(
        notice_id=new_id(),
        show_id=show_id,
        theater_id=show.theater_id,
        title=body.title,
        body=body.body,
        audience=body.audience,
        pinned=body.pinned,
        author_id=user.user_id,
        created_at=stamp,
        updated_at=stamp,
    )
    ctx.store.put_notice(notice)
    if body.email:
        audience = [
            m.user_id
            for m in ctx.store.list_members(show_id)
            if _reaches(body.audience, m) and m.user_id != user.user_id
        ]
        for person in ctx.store.get_users(audience):
            if person.prefs.notice_emails:
                ctx.mailer.send(
                    mailer.notice_email(
                        to=person.email,
                        show_name=show.name,
                        author=user.name or user.email,
                        title=notice.title,
                        body=notice.body,
                        url=ctx.link(f"/shows/{show_id}"),
                    )
                )
    return notice


def _find(ctx: Ctx, show_id: str, notice_id: str) -> tuple[Notice, list[NoticeRead]]:
    part = ctx.store.load_show(show_id)
    notice = next((n for n in part.notices if n.notice_id == notice_id), None)
    if not notice:
        raise NotFound("Notice not found")
    return notice, [r for r in part.reads if r.notice_id == notice_id]


def update_notice(ctx: Ctx, user: User, show_id: str, notice_id: str, body: UpdateNoticeBody) -> Notice:
    editable_show(ctx, show_id, user, "callboard:post")
    notice, _ = _find(ctx, show_id, notice_id)
    fields = {k: getattr(body, k) for k in body.model_fields_set if getattr(body, k) is not None}
    notice = notice.model_copy(update={**fields, "updated_at": now_iso()})
    ctx.store.put_notice(notice)
    return notice


def delete_notice(ctx: Ctx, user: User, show_id: str, notice_id: str) -> None:
    editable_show(ctx, show_id, user, "callboard:post")
    _, reads = _find(ctx, show_id, notice_id)
    ctx.store.delete_notice(show_id, notice_id, reads)


class MarkReadBody(Model):
    notice_ids: list[str] = Field(max_length=200)


def mark_read(ctx: Ctx, user: User, show_id: str, body: MarkReadBody) -> None:
    readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    known = {n.notice_id for n in part.notices}
    done = {r.notice_id for r in part.reads if r.user_id == user.user_id}
    stamp = now_iso()
    for notice_id in dict.fromkeys(body.notice_ids):
        if notice_id in known and notice_id not in done:
            ctx.store.put_notice_read(
                NoticeRead(show_id=show_id, notice_id=notice_id, user_id=user.user_id, at=stamp)
            )
