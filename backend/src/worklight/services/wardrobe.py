"""Costumes and props for one show: what each character wears and carries, where it comes from, what it
costs, and getting it all back after closing.

Staff tick people as having costume access or props access. Those people manage that side of the tracker;
other staff can look but not change anything. Cast see only their own items, by scene, without status,
sources or money. Borrowed, rented and company-stock items turn into one strike task per lender."""

from typing import Annotated

from pydantic import Field

from worklight import clock, mailer
from worklight.ids import new_id, now_iso
from worklight.models import (
    Call,
    CallContent,
    ItemKind,
    ItemSource,
    ItemStatus,
    Model,
    Show,
    ShowItem,
    StrikeTask,
    User,
)
from worklight.services.base import (
    Conflict,
    Ctx,
    Forbidden,
    Invalid,
    NotFound,
    OptionalDate,
    ShowAccess,
    maybe_text,
    optional_text,
    readable_show,
    text,
)
from worklight.services.photo_uploads import Photo, check_photo_ids, drop_photos, photo_views
from worklight.store import ShowPartition

MAX_ITEMS = 1000
MAX_CENTS = 10_000_000
RETURNS_AREA = "Returns"
RESTOCK = "restock"

Cents = Annotated[int, Field(ge=0, le=MAX_CENTS)]


# ---- Who can do what --------------------------------------------------------------------------------


def edit_kinds(access: ShowAccess) -> set[ItemKind]:
    """The sides of the tracker this person manages, from the ticks on their membership."""
    m = access.membership
    kinds: set[ItemKind] = set()
    if m and m.costume_access:
        kinds.add("costume")
    if m and m.props_access:
        kinds.add("prop")
    return kinds


def can_view_tracker(access: ShowAccess) -> bool:
    return access.can("schedule:edit") or bool(edit_kinds(access))


def _tracker_access(ctx: Ctx, show_id: str, user: User) -> ShowAccess:
    access = readable_show(ctx, show_id, user)
    if not can_view_tracker(access):
        raise Forbidden("Only staff and people with costume or props access can open the tracker")
    return access


def _require_kind(access: ShowAccess, *kinds: ItemKind) -> None:
    access.require_open()
    mine = edit_kinds(access)
    for kind in kinds:
        if kind not in mine:
            if kind == "costume":
                raise Forbidden("You need costume access to change costumes")
            raise Forbidden("You need props access to change props")


# ---- Views ---------------------------------------------------------------------------------------


class SceneRef(Model):
    scene_id: str
    number: str
    name: str


class Person(Model):
    user_id: str
    name: str | None = None


class CharacterRow(Model):
    char_id: str
    name: str
    ensemble: bool = False
    cast: list[Person] = []
    # The scenes the character is in, from the breakdown, to fill in a new item's scenes.
    scene_ids: list[str] = []


class Fitting(Model):
    call_id: str
    user_id: str
    date: str
    start: str
    end: str


class ItemView(ShowItem):
    photos: list[Photo] = []
    stock_name: str | None = None


class Deposit(Model):
    item_id: str
    name: str
    lender: str | None = None
    deposit_cents: int
    due_back: str | None = None


class Money(Model):
    # Bought and built items plus rental fees.
    spent_cents: int
    bought_cents: int
    rental_cents: int
    # Deposits paid and not yet back.
    deposits_out_cents: int
    deposits: list[Deposit]


class KindCounts(Model):
    total: int = 0
    needed: int = 0
    pulled: int = 0
    building: int = 0
    ready: int = 0


class Tracker(Model):
    items: list[ItemView]
    characters: list[CharacterRow]
    scenes: list[SceneRef]
    # Each person's next fitting, from today on.
    fittings: list[Fitting]
    costumes: KindCounts
    props: KindCounts
    money: Money
    lenders: list[str]
    can_edit_costumes: bool
    can_edit_props: bool
    # Costume access: can open cast measurements.
    can_see_measurements: bool


def _content(call: Call, staff: bool) -> CallContent | None:
    return call if staff else call.published


def _fittings(part: ShowPartition, staff: bool) -> list[Fitting]:
    """The next fitting for each person called to one."""
    today = clock.today().isoformat()
    best: dict[str, Fitting] = {}
    for c in part.calls:
        content = _content(c, staff)
        if not content or content.type != "fitting" or content.cancelled or content.date < today:
            continue
        people = set(content.user_ids) | {u for b in content.blocks for u in b.user_ids}
        for u in people:
            f = Fitting(call_id=c.call_id, user_id=u, date=content.date, start=content.start, end=content.end)
            if u not in best or (f.date, f.start) < (best[u].date, best[u].start):
                best[u] = f
    return sorted(best.values(), key=lambda f: (f.date, f.start))


def _counts(items: list[ShowItem], kind: ItemKind) -> KindCounts:
    mine = [i for i in items if i.kind == kind]
    return KindCounts(
        total=len(mine),
        needed=sum(1 for i in mine if i.status == "needed"),
        pulled=sum(1 for i in mine if i.status == "pulled"),
        building=sum(1 for i in mine if i.status == "building"),
        ready=sum(1 for i in mine if i.status == "ready"),
    )


def _money(items: list[ShowItem]) -> Money:
    bought = sum(i.cost_cents or 0 for i in items)
    rental = sum(i.rental_fee_cents or 0 for i in items)
    out = [i for i in items if i.deposit_cents and not i.deposit_back_at]
    return Money(
        spent_cents=bought + rental,
        bought_cents=bought,
        rental_cents=rental,
        deposits_out_cents=sum(i.deposit_cents or 0 for i in out),
        deposits=[
            Deposit(
                item_id=i.item_id,
                name=i.name,
                lender=i.lender,
                deposit_cents=i.deposit_cents or 0,
                due_back=i.due_back,
            )
            for i in sorted(out, key=lambda i: (i.due_back or "9999", i.name.lower()))
        ],
    )


def _characters(ctx: Ctx, part: ShowPartition) -> list[CharacterRow]:
    names = {
        u.user_id: u.name for u in ctx.store.get_users({u for c in part.characters for u in c.cast_user_ids})
    }
    scenes_of: dict[str, list[str]] = {}
    order = {s.scene_id: s.order for s in part.scenes}
    for a in part.appearances:
        scenes_of.setdefault(a.char_id, []).append(a.scene_id)
    return [
        CharacterRow(
            char_id=c.char_id,
            name=c.name,
            ensemble=c.ensemble,
            cast=[Person(user_id=u, name=names.get(u)) for u in c.cast_user_ids],
            scene_ids=sorted(scenes_of.get(c.char_id, []), key=lambda s: order.get(s, 0)),
        )
        for c in part.characters
    ]


def _item_views(ctx: Ctx, show: Show, items: list[ShowItem]) -> list[ItemView]:
    stock_ids = {i.stock_item_id for i in items if i.stock_item_id}
    stock = {s.item_id: s for s in ctx.store.list_stock(show.theater_id)} if stock_ids else {}
    return [
        ItemView(
            **i.model_dump(),
            photos=photo_views(ctx, show.theater_id, i.photo_ids),
            stock_name=stock[i.stock_item_id].name if i.stock_item_id in stock else None,
        )
        for i in items
    ]


def get_tracker(ctx: Ctx, user: User, show_id: str) -> Tracker:
    access = _tracker_access(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    items = sorted(part.items, key=lambda i: (i.kind, i.name.lower()))
    open_ = access.show.status != "archived"
    kinds = edit_kinds(access) if open_ else set()
    return Tracker(
        items=_item_views(ctx, access.show, items),
        characters=_characters(ctx, part),
        scenes=[SceneRef(scene_id=s.scene_id, number=s.number, name=s.name) for s in part.scenes],
        fittings=_fittings(part, access.can("schedule:edit")),
        costumes=_counts(items, "costume"),
        props=_counts(items, "prop"),
        money=_money(items),
        lenders=sorted({i.lender for i in items if i.lender}, key=str.lower),
        can_edit_costumes="costume" in kinds,
        can_edit_props="prop" in kinds,
        can_see_measurements="costume" in edit_kinds(access),
    )


# ---- Editing items -------------------------------------------------------------------------------


class CreateItemBody(Model):
    kind: ItemKind
    name: Annotated[str, text(120)]
    char_ids: list[str] = Field(default=[], max_length=50)
    scene_ids: list[str] = Field(default=[], max_length=200)
    status: ItemStatus = "needed"
    source: ItemSource | None = None
    lender: optional_text(120) = None  # type: ignore[valid-type]
    lender_contact: optional_text(200) = None  # type: ignore[valid-type]
    due_back: OptionalDate = None
    cost_cents: Cents | None = None
    rental_fee_cents: Cents | None = None
    deposit_cents: Cents | None = None
    notes: optional_text(1000) = None  # type: ignore[valid-type]
    photo_ids: list[str] = Field(default=[], max_length=20)


class UpdateItemBody(Model):
    kind: ItemKind | None = None
    name: maybe_text(120) = None  # type: ignore[valid-type]
    char_ids: list[str] | None = Field(default=None, max_length=50)
    scene_ids: list[str] | None = Field(default=None, max_length=200)
    status: ItemStatus | None = None
    source: ItemSource | None = None
    lender: optional_text(120) = None  # type: ignore[valid-type]
    lender_contact: optional_text(200) = None  # type: ignore[valid-type]
    due_back: OptionalDate = None
    cost_cents: Cents | None = None
    rental_fee_cents: Cents | None = None
    deposit_cents: Cents | None = None
    notes: optional_text(1000) = None  # type: ignore[valid-type]
    photo_ids: list[str] | None = Field(default=None, max_length=20)
    # Back with its lender or in company stock.
    returned: bool | None = None
    # The deposit came back.
    deposit_back: bool | None = None


def _check_refs(
    part: ShowPartition, char_ids: list[str], scene_ids: list[str]
) -> tuple[list[str], list[str]]:
    chars = {c.char_id for c in part.characters}
    scenes = {s.scene_id for s in part.scenes}
    char_ids, scene_ids = list(dict.fromkeys(char_ids)), list(dict.fromkeys(scene_ids))
    if any(c not in chars for c in char_ids):
        raise Invalid("charIds has a character that isn't in this show")
    if any(s not in scenes for s in scene_ids):
        raise Invalid("sceneIds has a scene that isn't in this show")
    order = {s.scene_id: s.order for s in part.scenes}
    return char_ids, sorted(scene_ids, key=lambda s: order[s])


def _clean_source(item: ShowItem) -> ShowItem:
    """Lender details only make sense for rented and borrowed things."""
    if item.source in ("rented", "borrowed"):
        return item
    return item.model_copy(update={"lender": None, "lender_contact": None, "due_back": None})


def create_item(ctx: Ctx, user: User, show_id: str, body: CreateItemBody) -> ItemView:
    access = readable_show(ctx, show_id, user)
    _require_kind(access, body.kind)
    if body.source == "stock":
        raise Invalid("Pull a company item from stock to add it from there")
    part = ctx.store.load_show(show_id)
    if len(part.items) >= MAX_ITEMS:
        raise Invalid(f"A show can track at most {MAX_ITEMS} costumes and props")
    char_ids, scene_ids = _check_refs(part, body.char_ids, body.scene_ids)
    stamp = now_iso()
    item = _clean_source(
        ShowItem(
            **body.model_dump(exclude={"char_ids", "scene_ids", "photo_ids"}),
            item_id=new_id(),
            show_id=show_id,
            theater_id=access.show.theater_id,
            char_ids=char_ids,
            scene_ids=scene_ids,
            photo_ids=check_photo_ids(body.photo_ids),
            created_at=stamp,
            updated_at=stamp,
        )
    )
    ctx.store.put_show_item(item)
    sync_return_tasks(ctx, access.show)
    return _item_views(ctx, access.show, [item])[0]


def _find(ctx: Ctx, show_id: str, item_id: str) -> ShowItem:
    item = ctx.store.get_show_item(show_id, item_id)
    if not item:
        raise NotFound("Item not found")
    return item


def _free_stock(ctx: Ctx, item: ShowItem) -> None:
    if not item.stock_item_id:
        return
    stock = ctx.store.get_stock_item(item.theater_id, item.stock_item_id)
    if stock and stock.in_show_item_id == item.item_id:
        ctx.store.put_stock_item(
            stock.model_copy(update={"in_show_id": None, "in_show_item_id": None, "updated_at": now_iso()})
        )


def _take_stock(ctx: Ctx, item: ShowItem) -> None:
    if not item.stock_item_id:
        return
    stock = ctx.store.get_stock_item(item.theater_id, item.stock_item_id)
    if not stock:
        return
    if stock.in_show_id and stock.in_show_item_id != item.item_id:
        raise Conflict(f"{stock.name} is out with another show")
    ctx.store.put_stock_item(
        stock.model_copy(
            update={"in_show_id": item.show_id, "in_show_item_id": item.item_id, "updated_at": now_iso()}
        )
    )


def _stock_photo_ids(ctx: Ctx, item: ShowItem) -> set[str]:
    if not item.stock_item_id:
        return set()
    stock = ctx.store.get_stock_item(item.theater_id, item.stock_item_id)
    return set(stock.photo_ids) if stock else set()


def update_item(ctx: Ctx, user: User, show_id: str, item_id: str, body: UpdateItemBody) -> ItemView:
    access = readable_show(ctx, show_id, user)
    item = _find(ctx, show_id, item_id)
    _require_kind(access, item.kind, *([body.kind] if body.kind else []))
    fields = body.model_fields_set
    update: dict[str, object] = {"updated_at": now_iso()}
    for name in ("kind", "name", "status"):
        if getattr(body, name) is not None:
            update[name] = getattr(body, name)
    for name in (
        "source",
        "lender",
        "lender_contact",
        "due_back",
        "cost_cents",
        "rental_fee_cents",
        "deposit_cents",
        "notes",
    ):
        if name in fields:
            update[name] = getattr(body, name)
    if update.get("source") == "stock" and not item.stock_item_id:
        raise Invalid("Pull a company item from stock to add it from there")
    if item.stock_item_id and "source" in update and update["source"] != "stock":
        raise Invalid("This came from company stock. Delete it and add it again to change where it's from.")
    if body.char_ids is not None or body.scene_ids is not None:
        part = ctx.store.load_show(show_id)
        chars, scenes = _check_refs(
            part,
            body.char_ids if body.char_ids is not None else item.char_ids,
            body.scene_ids if body.scene_ids is not None else item.scene_ids,
        )
        update["char_ids"], update["scene_ids"] = chars, scenes
    removed: list[str] = []
    if body.photo_ids is not None:
        update["photo_ids"] = check_photo_ids(body.photo_ids)
        keep = set(body.photo_ids) | _stock_photo_ids(ctx, item)
        removed = [p for p in item.photo_ids if p not in keep]
    if body.returned is True and not item.returned_at:
        update["returned_at"] = now_iso()
    elif body.returned is False:
        update["returned_at"] = None
    if body.deposit_back is True and not item.deposit_back_at:
        update["deposit_back_at"] = now_iso()
    elif body.deposit_back is False:
        update["deposit_back_at"] = None
    updated = _clean_source(item.model_copy(update=update))
    ShowItem.model_validate(updated.model_dump())
    if updated.returned_at and not item.returned_at:
        _free_stock(ctx, updated)
    elif item.returned_at and not updated.returned_at:
        _take_stock(ctx, updated)
    ctx.store.put_show_item(updated)
    drop_photos(ctx, item.theater_id, removed)
    sync_return_tasks(ctx, access.show)
    return _item_views(ctx, access.show, [updated])[0]


def delete_item(ctx: Ctx, user: User, show_id: str, item_id: str) -> None:
    access = readable_show(ctx, show_id, user)
    item = _find(ctx, show_id, item_id)
    _require_kind(access, item.kind)
    if not item.returned_at:
        _free_stock(ctx, item)
    ctx.store.delete_show_item(show_id, item_id)
    keep = _stock_photo_ids(ctx, item)
    drop_photos(ctx, item.theater_id, [p for p in item.photo_ids if p not in keep])
    sync_return_tasks(ctx, access.show)


class PullBody(Model):
    stock_item_id: str
    char_ids: list[str] = Field(default=[], max_length=50)
    scene_ids: list[str] = Field(default=[], max_length=200)
    notes: optional_text(1000) = None  # type: ignore[valid-type]


def pull_from_stock(ctx: Ctx, user: User, show_id: str, body: PullBody) -> ItemView:
    """Adds a company item to the show. It's marked as out with this show until it's returned."""
    access = readable_show(ctx, show_id, user)
    show = access.show
    stock = ctx.store.get_stock_item(show.theater_id, body.stock_item_id)
    if not stock:
        raise NotFound("That item isn't in the company's stock")
    _require_kind(access, stock.kind)
    if stock.in_show_id:
        where = ctx.store.get_show(stock.in_show_id)
        raise Conflict(f"{stock.name} is already out with {where.name if where else 'another show'}")
    part = ctx.store.load_show(show_id)
    if len(part.items) >= MAX_ITEMS:
        raise Invalid(f"A show can track at most {MAX_ITEMS} costumes and props")
    char_ids, scene_ids = _check_refs(part, body.char_ids, body.scene_ids)
    stamp = now_iso()
    item = ShowItem(
        item_id=new_id(),
        show_id=show_id,
        theater_id=show.theater_id,
        kind=stock.kind,
        name=stock.name,
        char_ids=char_ids,
        scene_ids=scene_ids,
        status="pulled",
        source="stock",
        stock_item_id=stock.item_id,
        notes=body.notes,
        photo_ids=list(stock.photo_ids),
        created_at=stamp,
        updated_at=stamp,
    )
    ctx.store.put_show_item(item)
    ctx.store.put_stock_item(
        stock.model_copy(update={"in_show_id": show_id, "in_show_item_id": item.item_id, "updated_at": stamp})
    )
    sync_return_tasks(ctx, show)
    return _item_views(ctx, show, [item])[0]


# ---- What a cast member sees ----------------------------------------------------------------------


class MyItem(Model):
    item_id: str
    kind: ItemKind
    name: str
    # The characters of mine it's for.
    characters: list[str]
    scene_ids: list[str]
    photos: list[Photo] = []


class MyItems(Model):
    items: list[MyItem]
    scenes: list[SceneRef]
    next_fitting: Fitting | None = None
    # How many of the 16 numbered measurements are filled in, and when they were last changed.
    measured: int = 0
    measurements_updated_at: str | None = None


def my_items(ctx: Ctx, user: User, show_id: str) -> MyItems:
    """My costumes and props, for the characters I play. No status, source or money."""
    access = readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    mine = {c.char_id: c.name for c in part.characters if user.user_id in c.cast_user_ids}
    items = [i for i in part.items if set(i.char_ids) & mine.keys()]
    scene_order = {s.scene_id: s.order for s in part.scenes}
    items.sort(
        key=lambda i: (min((scene_order.get(s, 9999) for s in i.scene_ids), default=9999), i.kind, i.name)
    )
    used = {s for i in items for s in i.scene_ids}
    fitting = next((f for f in _fittings(part, False) if f.user_id == user.user_id), None)
    from worklight.services.measurements import NUMBERED

    m = ctx.store.get_measurements(user.user_id)
    return MyItems(
        items=[
            MyItem(
                item_id=i.item_id,
                kind=i.kind,
                name=i.name,
                characters=[mine[c] for c in i.char_ids if c in mine],
                scene_ids=i.scene_ids,
                photos=photo_views(ctx, access.show.theater_id, i.photo_ids),
            )
            for i in items
        ],
        scenes=[
            SceneRef(scene_id=s.scene_id, number=s.number, name=s.name)
            for s in part.scenes
            if s.scene_id in used
        ],
        next_fitting=fitting,
        measured=sum(1 for f in NUMBERED if m and getattr(m, f) is not None),
        measurements_updated_at=m.updated_at if m else None,
    )


# ---- Strike: one return task per lender --------------------------------------------------------------


def return_key(item: ShowItem) -> str | None:
    """Which strike return task an item belongs to, or None if nothing has to go back."""
    if item.stock_item_id:
        return RESTOCK
    if item.source in ("rented", "borrowed"):
        return f"lender:{(item.lender or '').strip().lower()}"
    return None


def _task_text(key: str, items: list[ShowItem]) -> str:
    n = len(items)
    things = f"{n} item{'s' if n != 1 else ''}"
    if key == RESTOCK:
        return f"Put {things} back in company stock"
    # The lender's name as it was first typed.
    lender = next((i.lender.strip() for i in sorted(items, key=lambda i: i.created_at) if i.lender), None)
    return (
        f"Return {things} to {lender}" if lender else f"Return {things} (rented or borrowed, no lender named)"
    )


def _task_note(key: str, items: list[ShowItem]) -> str | None:
    if key == RESTOCK:
        return None
    due = min((i.due_back for i in items if i.due_back), default=None)
    contact = next((i.lender_contact for i in items if i.lender_contact), None)
    parts = [f"Due back {mailer.pretty_date(due)}" if due else None, contact]
    return " · ".join(p for p in parts if p) or None


def _strike_started(part: ShowPartition) -> bool:
    return bool(part.strike_tasks) or any(c.type == "strike" and not c.cancelled for c in part.calls)


def sync_return_tasks(ctx: Ctx, show: Show) -> None:
    """Keeps the strike checklist's Returns tasks in step with the tracker, once strike is on the schedule.

    One task per lender (and one for company stock) lists everything still out. A task that's ticked off
    stays as it is, unless something new joins its group, which reopens it."""
    part = ctx.store.load_show(show.show_id)
    if not _strike_started(part):
        return
    groups: dict[str, list[ShowItem]] = {}
    for item in part.items:
        key = return_key(item)
        if key and not item.returned_at:
            groups.setdefault(key, []).append(item)
    existing = {t.return_key: t for t in part.strike_tasks if t.return_key}
    stamp = now_iso()
    order = max((t.order for t in part.strike_tasks), default=0)
    puts: list[StrikeTask] = []
    for key, items in sorted(groups.items(), key=lambda kv: (kv[0] == RESTOCK, kv[0])):
        text_, note = _task_text(key, items), _task_note(key, items)
        task = existing.get(key)
        if task is None:
            order += 1
            puts.append(
                StrikeTask(
                    task_id=new_id(),
                    show_id=show.show_id,
                    area=RETURNS_AREA,
                    text=text_,
                    note=note,
                    order=order,
                    return_key=key,
                    created_at=stamp,
                    updated_at=stamp,
                )
            )
        elif task.text != text_ or task.note != note or task.done_at:
            puts.append(
                task.model_copy(
                    update={
                        "text": text_,
                        "note": note,
                        "done_at": None,
                        "done_by": None,
                        "updated_at": stamp,
                    }
                )
            )
    if puts:
        ctx.store.put_strike_tasks(puts)
    for key, task in existing.items():
        if key not in groups and not task.done_at:
            ctx.store.delete_strike_task(show.show_id, task.task_id)


def return_items_for(part: ShowPartition) -> dict[str, list[str]]:
    """Item names under each return key, for the strike checklist."""
    out: dict[str, list[str]] = {}
    for item in sorted(part.items, key=lambda i: i.name.lower()):
        key = return_key(item)
        if key:
            out.setdefault(key, []).append(item.name)
    return out


def mark_group_returned(ctx: Ctx, show_id: str, key: str) -> None:
    """Ticking off a Returns task on the strike checklist marks everything in it as back."""
    stamp = now_iso()
    done = [
        i.model_copy(update={"returned_at": stamp, "updated_at": stamp})
        for i in ctx.store.list_show_items(show_id)
        if return_key(i) == key and not i.returned_at
    ]
    for item in done:
        _free_stock(ctx, item)
    if done:
        ctx.store.put_show_items(done)
