"""Strike: the company's standard strike list, and each show's checklist copied from it.

Company admins keep the template (areas and tasks, no people). A show's staff edit their copy and assign
each task to named crew or staff, who see their own tasks and tick them off."""

from typing import Annotated

from pydantic import Field

from worklight.ids import new_id, now_iso
from worklight.models import CallContent, Model, Show, StrikeTask, StrikeTemplateTask, User
from worklight.services.base import (
    Ctx,
    Forbidden,
    Invalid,
    NotFound,
    editable_show,
    maybe_text,
    optional_text,
    readable_show,
    text,
)
from worklight.services.theaters import admin_theater

# The roles a strike task can go to. Cast aren't offered.
ASSIGNABLE = ("crew", "staff")


class Assignee(Model):
    user_id: str
    name: str | None = None


class StrikeTaskView(StrikeTask):
    assignees: list[Assignee] = []
    done_by_name: str | None = None
    # Whether the person looking can tick it off (staff, or one of its assignees).
    can_check: bool = False


class StrikeCallView(Model):
    call_id: str
    date: str
    start: str
    end: str
    location: str | None = None


class StrikeChecklist(Model):
    # Staff get every task; everyone else gets only the tasks assigned to them.
    tasks: list[StrikeTaskView]
    # Areas in the order they appear on the list.
    areas: list[str]
    done_count: int
    unassigned_count: int
    # The show's strike calls (normally one), so the checklist can say when strike is.
    calls: list[StrikeCallView]
    can_edit: bool
    # The company has a template to copy from.
    template_available: bool = False


def _views(
    tasks: list[StrikeTask], names: dict[str, str | None], me: str, staff: bool
) -> list[StrikeTaskView]:
    return [
        StrikeTaskView(
            **t.model_dump(),
            assignees=[Assignee(user_id=u, name=names.get(u)) for u in t.assignee_ids],
            done_by_name=names.get(t.done_by) if t.done_by else None,
            can_check=staff or me in t.assignee_ids,
        )
        for t in tasks
    ]


def _areas(tasks: list[StrikeTask]) -> list[str]:
    return list(dict.fromkeys(t.area for t in tasks))


def _grouped(tasks: list[StrikeTask]) -> list[StrikeTask]:
    """Tasks area by area (areas in the order they first appear), keeping order within each."""
    rank = {a: i for i, a in enumerate(_areas(sorted(tasks, key=lambda t: t.order)))}
    return sorted(tasks, key=lambda t: (rank[t.area], t.order))


def get_checklist(ctx: Ctx, user: User, show_id: str) -> StrikeChecklist:
    access = readable_show(ctx, show_id, user)
    part = ctx.store.load_show(show_id)
    staff = access.can("strike:edit")
    tasks = _grouped(part.strike_tasks)
    visible = tasks if staff else [t for t in tasks if user.user_id in t.assignee_ids]
    people = {u for t in visible for u in t.assignee_ids} | {t.done_by for t in visible if t.done_by}
    names = {u.user_id: u.name for u in ctx.store.get_users(people)}
    calls = []
    for c in part.calls:
        content: CallContent | None = c if staff else c.published
        if content and content.type == "strike" and not content.cancelled:
            calls.append(
                StrikeCallView(
                    call_id=c.call_id,
                    date=content.date,
                    start=content.start,
                    end=content.end,
                    location=content.location,
                )
            )
    calls.sort(key=lambda c: (c.date, c.start))
    editable = staff and access.show.status != "archived"
    return StrikeChecklist(
        tasks=_views(visible, names, user.user_id, staff),
        areas=_areas(visible),
        done_count=sum(1 for t in visible if t.done_at),
        unassigned_count=sum(1 for t in visible if not t.assignee_ids),
        calls=calls,
        can_edit=editable,
        template_available=editable and bool(ctx.store.list_strike_template(access.show.theater_id)),
    )


def _check_assignees(ctx: Ctx, show_id: str, user_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return ids
    members = {m.user_id: m for m in ctx.store.list_members(show_id)}
    if any(u not in members or members[u].role not in ASSIGNABLE for u in ids):
        raise Invalid("Strike tasks can only go to crew and staff in this show")
    return ids


class AddTaskBody(Model):
    area: Annotated[str, text(60)]
    text: Annotated[str, text(200)]
    note: optional_text(500) = None  # type: ignore[valid-type]
    assignee_ids: list[str] = Field(default=[], max_length=20)


def add_task(ctx: Ctx, user: User, show_id: str, body: AddTaskBody) -> StrikeTask:
    editable_show(ctx, show_id, user, "strike:edit")
    tasks = ctx.store.list_strike_tasks(show_id)
    if len(tasks) >= 300:
        raise Invalid("A strike checklist can have at most 300 tasks")
    # A new task goes at the end of its area (or starts a new area at the bottom).
    in_area = [t.order for t in tasks if t.area == body.area]
    order = (max(in_area) if in_area else max((t.order for t in tasks), default=0)) + 1
    if in_area:
        # Make room by pushing everything after it down one.
        later = [t.model_copy(update={"order": t.order + 1}) for t in tasks if t.order >= order]
        if later:
            ctx.store.put_strike_tasks(later)
    stamp = now_iso()
    task = StrikeTask(
        task_id=new_id(),
        show_id=show_id,
        area=body.area,
        text=body.text,
        order=order,
        note=body.note,
        assignee_ids=_check_assignees(ctx, show_id, body.assignee_ids),
        created_at=stamp,
        updated_at=stamp,
    )
    ctx.store.put_strike_task(task)
    return task


class UpdateTaskBody(Model):
    area: maybe_text(60) = None  # type: ignore[valid-type]
    text: maybe_text(200) = None  # type: ignore[valid-type]
    note: optional_text(500) = None  # type: ignore[valid-type]
    assignee_ids: list[str] | None = Field(default=None, max_length=20)
    # Ticked off (or un-ticked). Assignees may change only this.
    done: bool | None = None


def _find(ctx: Ctx, show_id: str, task_id: str) -> StrikeTask:
    task = next((t for t in ctx.store.list_strike_tasks(show_id) if t.task_id == task_id), None)
    if not task:
        raise NotFound("Task not found")
    return task


def update_task(ctx: Ctx, user: User, show_id: str, task_id: str, body: UpdateTaskBody) -> StrikeTask:
    access = readable_show(ctx, show_id, user).require_open()
    task = _find(ctx, show_id, task_id)
    fields = body.model_fields_set
    # Assignees can only tick their own tasks off.
    if not access.can("strike:edit") and (fields - {"done"} or user.user_id not in task.assignee_ids):
        raise Forbidden()
    update: dict[str, object] = {"updated_at": now_iso()}
    if body.area is not None:
        update["area"] = body.area
    if body.text is not None:
        update["text"] = body.text
    if "note" in fields:
        update["note"] = body.note
    if body.assignee_ids is not None:
        update["assignee_ids"] = _check_assignees(ctx, show_id, body.assignee_ids)
    if body.done is True and not task.done_at:
        update["done_at"] = now_iso()
        update["done_by"] = user.user_id
    elif body.done is False:
        update["done_at"] = None
        update["done_by"] = None
    updated = task.model_copy(update=update)
    ctx.store.put_strike_task(updated)
    return updated


def delete_task(ctx: Ctx, user: User, show_id: str, task_id: str) -> None:
    editable_show(ctx, show_id, user, "strike:edit")
    _find(ctx, show_id, task_id)
    ctx.store.delete_strike_task(show_id, task_id)


def copy_template_into(ctx: Ctx, show: Show) -> int:
    """Adds the company template's tasks to the end of the show's checklist. Returns how many."""
    template = ctx.store.list_strike_template(show.theater_id)
    start = max((t.order for t in ctx.store.list_strike_tasks(show.show_id)), default=0)
    stamp = now_iso()
    tasks = [
        StrikeTask(
            task_id=new_id(),
            show_id=show.show_id,
            area=t.area,
            text=t.text,
            order=start + i + 1,
            created_at=stamp,
            updated_at=stamp,
        )
        for i, t in enumerate(template)
    ]
    ctx.store.put_strike_tasks(tasks)
    return len(tasks)


def copy_template(ctx: Ctx, user: User, show_id: str) -> StrikeChecklist:
    show = editable_show(ctx, show_id, user, "strike:edit").show
    if not copy_template_into(ctx, show):
        raise Invalid("The company's strike template is empty")
    return get_checklist(ctx, user, show_id)


def start_checklist_if_empty(ctx: Ctx, show: Show) -> None:
    """When a show gets its first strike call, its checklist starts as a copy of the company template."""
    if not ctx.store.list_strike_tasks(show.show_id):
        copy_template_into(ctx, show)


# ---- Company template -----------------------------------------------------------------------------


class TemplateLine(Model):
    area: Annotated[str, text(60)]
    text: Annotated[str, text(200)]


class StrikeTemplate(Model):
    tasks: list[TemplateLine]


class PutTemplateBody(Model):
    tasks: list[TemplateLine] = Field(max_length=300)


def get_template(ctx: Ctx, user: User, theater_id: str) -> StrikeTemplate:
    admin_theater(ctx, user, theater_id)
    lines = ctx.store.list_strike_template(theater_id)
    return StrikeTemplate(tasks=[TemplateLine(area=t.area, text=t.text) for t in lines])


def put_template(ctx: Ctx, user: User, theater_id: str, body: PutTemplateBody) -> StrikeTemplate:
    """Replaces the whole template. Shows that already copied it keep their own lists."""
    admin_theater(ctx, user, theater_id)
    ctx.store.replace_strike_template(
        theater_id,
        [
            StrikeTemplateTask(task_id=new_id(), theater_id=theater_id, area=t.area, text=t.text, order=i + 1)
            for i, t in enumerate(body.tasks)
        ],
    )
    return get_template(ctx, user, theater_id)
