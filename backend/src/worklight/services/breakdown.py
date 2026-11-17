"""Script breakdown: acts, scenes, characters, who plays them, and the scenes x characters grid."""

from typing import Annotated

from pydantic import Field

from worklight.ids import new_id
from worklight.models import Act, Appearance, Breakdown, Character, Model, Scene, Show, User
from worklight.services.base import (
    Ctx,
    Invalid,
    NotFound,
    editable_show,
    maybe_text,
    optional_text,
    readable_show,
    text,
)


def scene_minutes(scene: Scene, show: Show) -> int:
    """Rehearsal time for a scene: the override, or pages x pace rounded to 5 minutes, at least 20."""
    if scene.minutes_override:
        return scene.minutes_override
    raw = scene.eighths / 8 * show.minutes_per_page
    return max(20, int(5 * round(raw / 5)))


def get_breakdown(ctx: Ctx, user: User, show_id: str) -> Breakdown:
    readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    return Breakdown(
        acts=part.acts, scenes=part.scenes, characters=part.characters, appearances=part.appearances
    )


# ---- Acts -----------------------------------------------------------------------------------------


class ActBody(Model):
    name: Annotated[str, text(80)]


def create_act(ctx: Ctx, user: User, show_id: str, body: ActBody) -> Act:
    editable_show(ctx, show_id, user, "breakdown:edit")
    acts = ctx.store.load_show(show_id).acts
    act = Act(
        act_id=new_id(), show_id=show_id, name=body.name, order=max((a.order for a in acts), default=0) + 1
    )
    ctx.store.put_act(act)
    return act


def update_act(ctx: Ctx, user: User, show_id: str, act_id: str, body: ActBody) -> Act:
    editable_show(ctx, show_id, user, "breakdown:edit")
    act = next((a for a in ctx.store.load_show(show_id).acts if a.act_id == act_id), None)
    if not act:
        raise NotFound("Act not found")
    act = act.model_copy(update={"name": body.name})
    ctx.store.put_act(act)
    return act


def delete_act(ctx: Ctx, user: User, show_id: str, act_id: str) -> None:
    """Deletes the act and every scene in it."""
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    if not any(a.act_id == act_id for a in part.acts):
        raise NotFound("Act not found")
    for scene in (s for s in part.scenes if s.act_id == act_id):
        ctx.store.delete_scene(
            show_id, scene.scene_id, [a for a in part.appearances if a.scene_id == scene.scene_id]
        )
    ctx.store.delete_act(show_id, act_id)


# ---- Scenes ---------------------------------------------------------------------------------------


class CreateSceneBody(Model):
    act_id: str
    name: Annotated[str, text(120)]
    # Leave out to number it "<act>.<scene>".
    number: optional_text(20) = None  # type: ignore[valid-type]
    eighths: int = Field(default=0, ge=0, le=8 * 200)
    minutes_override: int | None = Field(default=None, ge=5, le=600)
    character_ids: list[str] = Field(default=[], max_length=200)


class UpdateSceneBody(Model):
    act_id: str | None = None
    name: maybe_text(120) = None  # type: ignore[valid-type]
    number: maybe_text(20) = None  # type: ignore[valid-type]
    eighths: int | None = Field(default=None, ge=0, le=8 * 200)
    minutes_override: int | None = Field(default=None, ge=5, le=600)


def create_scene(ctx: Ctx, user: User, show_id: str, body: CreateSceneBody) -> Scene:
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    act_index = next((i for i, a in enumerate(part.acts, start=1) if a.act_id == body.act_id), None)
    if act_index is None:
        raise Invalid("actId doesn't match an act in this show")
    in_act = [s for s in part.scenes if s.act_id == body.act_id]
    # New scenes go at the end of their act; later scenes shift down by one.
    after = max((s.order for s in in_act), default=None)
    if after is None:
        earlier = [s.order for s in part.scenes if _act_pos(part.acts, s.act_id) < act_index]
        after = max(earlier, default=0)
    for s in part.scenes:
        if s.order > after:
            ctx.store.put_scene(s.model_copy(update={"order": s.order + 1}))
    scene = Scene(
        scene_id=new_id(),
        show_id=show_id,
        act_id=body.act_id,
        number=body.number or f"{act_index}.{len(in_act) + 1}",
        name=body.name,
        order=after + 1,
        eighths=body.eighths,
        minutes_override=body.minutes_override,
    )
    ctx.store.put_scene(scene)
    chars = {c.char_id for c in part.characters}
    for char_id in dict.fromkeys(body.character_ids):
        if char_id in chars:
            ctx.store.put_appearance(Appearance(show_id=show_id, scene_id=scene.scene_id, char_id=char_id))
    return scene


def _act_pos(acts: list[Act], act_id: str) -> int:
    return next((i for i, a in enumerate(acts, start=1) if a.act_id == act_id), 0)


def update_scene(ctx: Ctx, user: User, show_id: str, scene_id: str, body: UpdateSceneBody) -> Scene:
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    scene = next((s for s in part.scenes if s.scene_id == scene_id), None)
    if not scene:
        raise NotFound("Scene not found")
    if body.act_id is not None and not any(a.act_id == body.act_id for a in part.acts):
        raise Invalid("actId doesn't match an act in this show")
    fields = {
        k: getattr(body, k)
        for k in body.model_fields_set
        if getattr(body, k) is not None or k == "minutes_override"
    }
    scene = scene.model_copy(update=fields)
    ctx.store.put_scene(scene)
    return scene


def delete_scene(ctx: Ctx, user: User, show_id: str, scene_id: str) -> None:
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    if not any(s.scene_id == scene_id for s in part.scenes):
        raise NotFound("Scene not found")
    ctx.store.delete_scene(show_id, scene_id, [a for a in part.appearances if a.scene_id == scene_id])


class ReorderBody(Model):
    ids: list[str] = Field(max_length=500)


def reorder(ctx: Ctx, user: User, show_id: str, kind: str, body: ReorderBody) -> Breakdown:
    """Sets the order of acts, scenes or characters to the order of ids (which must list all of them)."""
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    items: dict[str, Act | Scene | Character]
    if kind == "acts":
        items = {a.act_id: a for a in part.acts}
    elif kind == "scenes":
        items = {s.scene_id: s for s in part.scenes}
    else:
        items = {c.char_id: c for c in part.characters}
    if sorted(body.ids) != sorted(items):
        raise Invalid(f"ids must list every one of the show's {kind} once")
    for order, item_id in enumerate(body.ids, start=1):
        item = items[item_id]
        if item.order != order:
            updated = item.model_copy(update={"order": order})
            if isinstance(updated, Act):
                ctx.store.put_act(updated)
            elif isinstance(updated, Scene):
                ctx.store.put_scene(updated)
            else:
                ctx.store.put_character(updated)
    return get_breakdown(ctx, user, show_id)


# ---- Characters -----------------------------------------------------------------------------------


class CreateCharacterBody(Model):
    name: Annotated[str, text(80)]
    ensemble: bool = False
    cast_user_ids: list[str] = Field(default=[], max_length=100)


class UpdateCharacterBody(Model):
    name: maybe_text(80) = None  # type: ignore[valid-type]
    ensemble: bool | None = None
    cast_user_ids: list[str] | None = Field(default=None, max_length=100)


def _check_cast(ctx: Ctx, show_id: str, user_ids: list[str]) -> list[str]:
    members = {m.user_id for m in ctx.store.list_members(show_id)}
    unknown = [u for u in user_ids if u not in members]
    if unknown:
        raise Invalid("castUserIds can only name people in this show")
    return list(dict.fromkeys(user_ids))


def create_character(ctx: Ctx, user: User, show_id: str, body: CreateCharacterBody) -> Character:
    editable_show(ctx, show_id, user, "breakdown:edit")
    chars = ctx.store.load_show(show_id).characters
    character = Character(
        char_id=new_id(),
        show_id=show_id,
        name=body.name,
        order=max((c.order for c in chars), default=0) + 1,
        ensemble=body.ensemble,
        cast_user_ids=_check_cast(ctx, show_id, body.cast_user_ids),
    )
    ctx.store.put_character(character)
    return character


def update_character(
    ctx: Ctx, user: User, show_id: str, char_id: str, body: UpdateCharacterBody
) -> Character:
    editable_show(ctx, show_id, user, "breakdown:edit")
    character = next((c for c in ctx.store.load_show(show_id).characters if c.char_id == char_id), None)
    if not character:
        raise NotFound("Character not found")
    fields = {k: getattr(body, k) for k in body.model_fields_set if getattr(body, k) is not None}
    if "cast_user_ids" in fields:
        fields["cast_user_ids"] = _check_cast(ctx, show_id, fields["cast_user_ids"])
    character = character.model_copy(update=fields)
    ctx.store.put_character(character)
    return character


def delete_character(ctx: Ctx, user: User, show_id: str, char_id: str) -> None:
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    if not any(c.char_id == char_id for c in part.characters):
        raise NotFound("Character not found")
    ctx.store.delete_character(show_id, char_id, [a for a in part.appearances if a.char_id == char_id])


def set_appearance(ctx: Ctx, user: User, show_id: str, scene_id: str, char_id: str, on: bool) -> None:
    editable_show(ctx, show_id, user, "breakdown:edit")
    part = ctx.store.load_show(show_id)
    if not any(s.scene_id == scene_id for s in part.scenes):
        raise NotFound("Scene not found")
    if not any(c.char_id == char_id for c in part.characters):
        raise NotFound("Character not found")
    if on:
        ctx.store.put_appearance(Appearance(show_id=show_id, scene_id=scene_id, char_id=char_id))
    else:
        ctx.store.delete_appearance(show_id, scene_id, char_id)


# ---- Casting helpers used by People -------------------------------------------------------------


def cast_in(ctx: Ctx, show_id: str, user_id: str, char_ids: list[str]) -> None:
    for character in ctx.store.load_show(show_id).characters:
        if character.char_id in char_ids and user_id not in character.cast_user_ids:
            ctx.store.put_character(
                character.model_copy(update={"cast_user_ids": [*character.cast_user_ids, user_id]})
            )


def uncast_everywhere(ctx: Ctx, show_id: str, user_id: str) -> None:
    for character in ctx.store.load_show(show_id).characters:
        if user_id in character.cast_user_ids:
            ctx.store.put_character(
                character.model_copy(
                    update={"cast_user_ids": [u for u in character.cast_user_ids if u != user_id]}
                )
            )


def parts_for(ctx: Ctx, show_id: str, user_id: str) -> list[str]:
    return [c.name for c in ctx.store.load_show(show_id).characters if user_id in c.cast_user_ids]
