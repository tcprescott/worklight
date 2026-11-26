"""The company's own costumes and props, kept between shows, and the keepers who look after them.

Company admins name the keepers. Costume keepers manage costume stock and props keepers manage prop stock.
People with costume or props access on one of the company's shows can browse that side of the stock to
pull things into their show."""

from typing import Annotated

from pydantic import Field

from worklight.ids import new_id, now_iso
from worklight.models import ItemKind, Keeper, Model, StockItem, User
from worklight.services.base import (
    Conflict,
    Ctx,
    Email,
    Forbidden,
    Invalid,
    NotFound,
    maybe_text,
    optional_text,
    text,
    user_for_email,
)
from worklight.services.photo_uploads import Photo, check_photo_ids, drop_photos, photo_views, save_photo
from worklight.services.theaters import admin_theater

MAX_STOCK = 5000


class StockRights(Model):
    edit_costumes: bool = False
    edit_props: bool = False
    view_costumes: bool = False
    view_props: bool = False


def rights(ctx: Ctx, user: User, theater_id: str) -> StockRights:
    if not ctx.store.get_theater(theater_id):
        raise NotFound("Theater not found")
    keeper = ctx.store.get_keeper(theater_id, user.user_id)
    r = StockRights(
        edit_costumes=bool(keeper and keeper.costumes),
        edit_props=bool(keeper and keeper.props),
    )
    r.view_costumes, r.view_props = r.edit_costumes, r.edit_props
    if ctx.store.is_theater_admin(theater_id, user.user_id):
        r.view_costumes = r.view_props = True
    if not (r.view_costumes and r.view_props):
        for m in ctx.store.list_memberships(user.user_id):
            if m.theater_id == theater_id:
                r.view_costumes = r.view_costumes or m.costume_access
                r.view_props = r.view_props or m.props_access
    if not (r.view_costumes or r.view_props):
        raise Forbidden(
            "Only the company's keepers, admins and people with costume or props access see stock"
        )
    return r


def _can_edit(r: StockRights, kind: ItemKind) -> bool:
    return r.edit_costumes if kind == "costume" else r.edit_props


def _require_edit(r: StockRights, kind: ItemKind) -> None:
    if not _can_edit(r, kind):
        who = "costume keepers" if kind == "costume" else "props keepers"
        raise Forbidden(f"Only the company's {who} can change that stock")


class StockItemView(StockItem):
    photos: list[Photo] = []
    in_show_name: str | None = None


class Stock(Model):
    theater_name: str
    items: list[StockItemView]
    categories: list[str]
    rights: StockRights


def get_stock(ctx: Ctx, user: User, theater_id: str) -> Stock:
    r = rights(ctx, user, theater_id)
    theater = ctx.store.get_theater(theater_id)
    items = [
        i
        for i in ctx.store.list_stock(theater_id)
        if (i.kind == "costume" and r.view_costumes) or (i.kind == "prop" and r.view_props)
    ]
    shows = {s.show_id: s.name for s in ctx.store.list_theater_shows(theater_id)}
    return Stock(
        theater_name=theater.name if theater else "",
        items=[_view(ctx, i, shows) for i in items],
        categories=sorted({i.category for i in items if i.category}, key=str.lower),
        rights=r,
    )


def _view(ctx: Ctx, item: StockItem, shows: dict[str, str] | None = None) -> StockItemView:
    if shows is None and item.in_show_id:
        show = ctx.store.get_show(item.in_show_id)
        shows = {show.show_id: show.name} if show else {}
    return StockItemView(
        **item.model_dump(),
        photos=photo_views(ctx, item.theater_id, item.photo_ids),
        in_show_name=(shows or {}).get(item.in_show_id or ""),
    )


class CreateStockBody(Model):
    kind: ItemKind
    name: Annotated[str, text(120)]
    category: optional_text(60) = None  # type: ignore[valid-type]
    size: optional_text(40) = None  # type: ignore[valid-type]
    location: optional_text(120) = None  # type: ignore[valid-type]
    notes: optional_text(1000) = None  # type: ignore[valid-type]
    photo_ids: list[str] = Field(default=[], max_length=20)


class UpdateStockBody(Model):
    name: maybe_text(120) = None  # type: ignore[valid-type]
    category: optional_text(60) = None  # type: ignore[valid-type]
    size: optional_text(40) = None  # type: ignore[valid-type]
    location: optional_text(120) = None  # type: ignore[valid-type]
    notes: optional_text(1000) = None  # type: ignore[valid-type]
    photo_ids: list[str] | None = Field(default=None, max_length=20)


def create_stock(ctx: Ctx, user: User, theater_id: str, body: CreateStockBody) -> StockItemView:
    r = rights(ctx, user, theater_id)
    _require_edit(r, body.kind)
    if len(ctx.store.list_stock(theater_id)) >= MAX_STOCK:
        raise Invalid(f"A company can keep at most {MAX_STOCK} stock items")
    stamp = now_iso()
    item = StockItem(
        **body.model_dump(exclude={"photo_ids"}),
        item_id=new_id(),
        theater_id=theater_id,
        photo_ids=check_photo_ids(body.photo_ids),
        created_at=stamp,
        updated_at=stamp,
    )
    ctx.store.put_stock_item(item)
    return _view(ctx, item)


def _find(ctx: Ctx, theater_id: str, item_id: str) -> StockItem:
    item = ctx.store.get_stock_item(theater_id, item_id)
    if not item:
        raise NotFound("Stock item not found")
    return item


def update_stock(ctx: Ctx, user: User, theater_id: str, item_id: str, body: UpdateStockBody) -> StockItemView:
    r = rights(ctx, user, theater_id)
    item = _find(ctx, theater_id, item_id)
    _require_edit(r, item.kind)
    fields = body.model_fields_set
    update: dict[str, object] = {"updated_at": now_iso()}
    if body.name is not None:
        update["name"] = body.name
    for f in ("category", "size", "location", "notes"):
        if f in fields:
            update[f] = getattr(body, f)
    removed: list[str] = []
    if body.photo_ids is not None:
        update["photo_ids"] = check_photo_ids(body.photo_ids)
        removed = [p for p in item.photo_ids if p not in body.photo_ids]
        # A show item pulled from this one may still show the picture.
        if item.in_show_id and item.in_show_item_id:
            show_item = ctx.store.get_show_item(item.in_show_id, item.in_show_item_id)
            removed = [p for p in removed if not show_item or p not in show_item.photo_ids]
    updated = item.model_copy(update=update)
    ctx.store.put_stock_item(updated)
    drop_photos(ctx, theater_id, removed)
    return _view(ctx, updated)


def delete_stock(ctx: Ctx, user: User, theater_id: str, item_id: str) -> None:
    r = rights(ctx, user, theater_id)
    item = _find(ctx, theater_id, item_id)
    _require_edit(r, item.kind)
    if item.in_show_id:
        show = ctx.store.get_show(item.in_show_id)
        raise Conflict(
            f"{item.name} is out with {show.name if show else 'a show'}. Mark it returned there first."
        )
    ctx.store.delete_stock_item(theater_id, item_id)
    drop_photos(ctx, theater_id, item.photo_ids)


def upload_stock_photo(ctx: Ctx, user: User, theater_id: str, data: bytes) -> Photo:
    r = rights(ctx, user, theater_id)
    if not (r.edit_costumes or r.edit_props):
        raise Forbidden("Only the company's keepers can add stock pictures")
    return save_photo(ctx, theater_id, data)


# ---- Keepers -------------------------------------------------------------------------------------


class KeeperView(Model):
    user_id: str
    name: str | None = None
    email: str
    costumes: bool
    props: bool


def list_keepers(ctx: Ctx, user: User, theater_id: str) -> list[KeeperView]:
    admin_theater(ctx, user, theater_id)
    return _keeper_views(ctx, theater_id)


def _keeper_views(ctx: Ctx, theater_id: str) -> list[KeeperView]:
    keepers = ctx.store.list_keepers(theater_id)
    users = {u.user_id: u for u in ctx.store.get_users(k.user_id for k in keepers)}
    views = [
        KeeperView(
            user_id=k.user_id,
            name=users[k.user_id].name,
            email=users[k.user_id].email,
            costumes=k.costumes,
            props=k.props,
        )
        for k in keepers
        if k.user_id in users
    ]
    return sorted(views, key=lambda k: (k.name or k.email).lower())


class PutKeeperBody(Model):
    email: Email
    name: optional_text(100) = None  # type: ignore[valid-type]
    costumes: bool = False
    props: bool = False


def put_keeper(ctx: Ctx, user: User, theater_id: str, body: PutKeeperBody) -> list[KeeperView]:
    """Names someone a costume and/or props keeper (or changes which). Neither ticked removes them."""
    admin_theater(ctx, user, theater_id)
    person = user_for_email(ctx, body.email, body.name)
    if body.name and not person.name:
        ctx.store.update_user_name(person.user_id, body.name)
    if body.costumes or body.props:
        ctx.store.put_keeper(
            Keeper(theater_id=theater_id, user_id=person.user_id, costumes=body.costumes, props=body.props)
        )
    else:
        ctx.store.delete_keeper(theater_id, person.user_id)
    return _keeper_views(ctx, theater_id)


def remove_keeper(ctx: Ctx, user: User, theater_id: str, keeper_id: str) -> list[KeeperView]:
    admin_theater(ctx, user, theater_id)
    ctx.store.delete_keeper(theater_id, keeper_id)
    return _keeper_views(ctx, theater_id)
