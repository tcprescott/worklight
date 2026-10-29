from typing import Annotated, Any

from worklight import keys
from worklight.models import Me, Model, MyShow, MyTheater, NotifyPrefs, User
from worklight.services.base import Ctx, Unauthorized, text, user_for_email


def user_from_claims(ctx: Ctx, claims: dict[str, Any]) -> User:
    """Maps the verified email in the ID token to a Worklight user, creating one on first sign-in."""
    raw_email = claims.get("email")
    verified = claims.get("email_verified") in (True, "true")
    if not isinstance(raw_email, str) or not raw_email or not verified:
        raise Unauthorized("Sign in required")
    return user_for_email(ctx, keys.normalize_email(raw_email))


def get_me(ctx: Ctx, user: User) -> Me:
    store = ctx.store
    admin_ids = store.list_admin_theater_ids(user.user_id)
    memberships = store.list_memberships(user.user_id)
    shows = {s.show_id: s for s in store.get_shows((m.theater_id, m.show_id) for m in memberships)}
    theaters = {
        t.theater_id: t for t in store.get_theaters([*admin_ids, *(m.theater_id for m in memberships)])
    }
    my_shows = [
        MyShow(
            show=shows[m.show_id],
            theater_name=theaters[m.theater_id].name if m.theater_id in theaters else "",
            role=m.role,
            title=m.title,
            status=m.status,
            conflicts_submitted_at=m.conflicts_submitted_at,
        )
        for m in memberships
        if m.show_id in shows
    ]
    my_shows.sort(key=lambda s: s.show.start_date)
    return Me(
        user=user,
        theaters=[MyTheater(theater=theaters[t], role="admin") for t in admin_ids if t in theaters],
        shows=my_shows,
    )


class UpdateMeBody(Model):
    name: Annotated[str, text(100)] | None = None
    prefs: NotifyPrefs | None = None


def update_me(ctx: Ctx, user: User, body: UpdateMeBody) -> User:
    if body.prefs is None and body.name is not None:
        ctx.store.update_user_name(user.user_id, body.name)
        return user.model_copy(update={"name": body.name})
    current = ctx.store.get_user(user.user_id) or user
    updated = current.model_copy(
        update={"name": body.name or current.name, "prefs": body.prefs or current.prefs}
    )
    ctx.store.put_user(updated)
    return updated
