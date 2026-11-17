"""GraphQL at /api/graphql: the same service layer as REST, signed in with an API key.

Reads cover the company, its shows, breakdowns, people, conflicts, the schedule and the callboard. Writes
(read and write keys only) cover building and publishing the schedule and posting notices."""

from dataclasses import dataclass
from typing import Any

import strawberry
from fastapi import Request
from strawberry.fastapi import BaseContext, GraphQLRouter
from strawberry.types import Info

from worklight.models import Model
from worklight.services import breakdown as breakdown_service
from worklight.services import callboard as callboard_service
from worklight.services import conflicts as conflicts_service
from worklight.services import schedule as schedule_service
from worklight.services import shows as shows_service
from worklight.services import theaters as theaters_service
from worklight.services.apikeys import KeyPrincipal, principal_for
from worklight.services.base import Ctx, ServiceError


def _build[T](cls: type[T], source: Model | dict[str, Any], **extra: Any) -> T:
    """Makes a GraphQL object from a model, taking the fields the GraphQL type declares."""
    data = source.model_dump() if isinstance(source, Model) else source
    names = {f.python_name for f in cls.__strawberry_definition__.fields}  # type: ignore[attr-defined]
    return cls(**{k: v for k, v in {**data, **extra}.items() if k in names})


# ---- Types -----------------------------------------------------------------------------------------


@strawberry.type
class RehearsalNight:
    weekday: int = strawberry.field(description="0 is Monday")
    start: str
    end: str


@strawberry.type
class Show:
    show_id: strawberry.ID
    name: str
    venue: str | None
    address: str | None
    timezone: str
    start_date: str
    end_date: str
    tech_start: str | None
    opening_date: str | None
    off_book_date: str | None
    conflict_deadline: str | None
    minutes_per_page: float
    skipped_dates: list[str]
    status: str

    @strawberry.field
    def rehearsal_nights(self, info: Info["GqlContext", None]) -> list[RehearsalNight]:
        show = info.context.principal.show(info.context.ctx, str(self.show_id))
        return [_build(RehearsalNight, s) for s in show.slots]


@strawberry.type
class ShowSummary:
    show: Show
    cast_count: int
    crew_count: int
    waiting_count: int = strawberry.field(description="People who haven't sent their conflicts yet")


@strawberry.type
class Theater:
    theater_id: strawberry.ID
    name: str
    shows: list[ShowSummary]


@strawberry.type
class Act:
    act_id: strawberry.ID
    name: str
    order: int


@strawberry.type
class Scene:
    scene_id: strawberry.ID
    act_id: str
    number: str
    name: str
    order: int
    eighths: int = strawberry.field(description="Length in eighths of a page")
    minutes_override: int | None
    character_ids: list[str]


@strawberry.type
class Character:
    char_id: strawberry.ID
    name: str
    order: int
    ensemble: bool
    cast_user_ids: list[str]


@strawberry.type
class Breakdown:
    acts: list[Act]
    scenes: list[Scene]
    characters: list[Character]


@strawberry.type
class Person:
    user_id: strawberry.ID
    name: str | None
    email: str | None
    role: str
    title: str | None
    department: str | None
    status: str
    conflicts_submitted_at: str | None


@strawberry.type
class Conflict:
    date: str | None
    weekday: int | None
    level: str
    arrive: str | None
    leave: str | None
    note: str | None


@strawberry.type
class PersonConflicts:
    user_id: strawberry.ID
    weekly: list[Conflict]
    dates: list[Conflict]


@strawberry.type
class Warning:
    user_id: str
    name: str | None
    part: str | None
    kind: str = strawberry.field(description="hard, soft, partial or elsewhere")
    arrive: str | None
    leave: str | None


@strawberry.type
class Block:
    block_id: strawberry.ID
    start: str
    end: str
    minutes: int
    scene_ids: list[str]
    label: str | None
    warnings: list[Warning]


@strawberry.type
class Call:
    call_id: strawberry.ID
    date: str
    start: str
    end: str
    type: str
    title: str | None
    location: str | None
    bring: str | None
    note: str | None
    crew_start: str | None
    cancelled: bool
    status: str
    unpublished_changes: bool
    called_count: int
    free_minutes: int
    blocks: list[Block]
    warnings: list[Warning]


@strawberry.type
class ScheduleDay:
    date: str
    kind: str
    start: str | None
    end: str | None
    no_conflicts: bool
    calls: list[Call]


@strawberry.type
class SceneSuggestion:
    scene_id: str
    minutes: int
    score: int
    nights_in_range: int
    last_rehearsed: str | None
    fits: bool
    warnings: list[Warning]


@strawberry.type
class Notice:
    notice_id: strawberry.ID
    title: str
    body: str
    audience: str
    pinned: bool
    author_name: str | None
    created_at: str
    read_count: int | None
    audience_count: int | None


@strawberry.type
class PublishResult:
    published: int
    cancelled: int
    notified: int


def _call(view: schedule_service.CallView) -> Call:
    return _build(
        Call,
        view,
        blocks=[_build(Block, b, warnings=[_build(Warning, w) for w in b.warnings]) for b in view.blocks],
        warnings=[_build(Warning, w) for w in view.warnings],
    )


# ---- Context ---------------------------------------------------------------------------------------


@dataclass
class GqlContext(BaseContext):
    ctx: Ctx
    principal: KeyPrincipal

    def __post_init__(self) -> None:
        super().__init__()

    def show_id(self, show_id: strawberry.ID | str) -> str:
        return self.principal.show(self.ctx, str(show_id)).show_id


GInfo = Info[GqlContext, None]


# ---- Query -----------------------------------------------------------------------------------------


@strawberry.type
class Query:
    @strawberry.field(description="The company this API key belongs to, with its shows")
    def theater(self, info: GInfo) -> Theater:
        c = info.context
        view = theaters_service.get_theater(c.ctx, c.principal.user, c.principal.key.theater_id)
        return Theater(
            theater_id=strawberry.ID(view.theater.theater_id),
            name=view.theater.name,
            shows=[_build(ShowSummary, s, show=_build(Show, s.show)) for s in view.shows],
        )

    @strawberry.field
    def show(self, info: GInfo, show_id: strawberry.ID) -> Show:
        c = info.context
        view = shows_service.get_show(c.ctx, c.principal.user, c.show_id(show_id))
        return _build(Show, view.show)

    @strawberry.field
    def breakdown(self, info: GInfo, show_id: strawberry.ID) -> Breakdown:
        c = info.context
        b = breakdown_service.get_breakdown(c.ctx, c.principal.user, c.show_id(show_id))
        in_scene: dict[str, list[str]] = {}
        for a in b.appearances:
            in_scene.setdefault(a.scene_id, []).append(a.char_id)
        return Breakdown(
            acts=[_build(Act, a) for a in b.acts],
            scenes=[_build(Scene, s, character_ids=in_scene.get(s.scene_id, [])) for s in b.scenes],
            characters=[_build(Character, ch) for ch in b.characters],
        )

    @strawberry.field
    def people(self, info: GInfo, show_id: strawberry.ID) -> list[Person]:
        c = info.context
        return [
            _build(Person, m) for m in shows_service.list_members(c.ctx, c.principal.user, c.show_id(show_id))
        ]

    @strawberry.field(description="Everyone's conflicts that touch the show's dates")
    def conflicts(self, info: GInfo, show_id: strawberry.ID) -> list[PersonConflicts]:
        c = info.context
        out = []
        for mc in conflicts_service.show_conflicts(c.ctx, c.principal.user, c.show_id(show_id)):
            out.append(
                PersonConflicts(
                    user_id=strawberry.ID(mc.user_id),
                    weekly=[_build(Conflict, w, date=None) for w in mc.weekly],
                    dates=[_build(Conflict, d, weekday=None) for d in mc.dates],
                )
            )
        return out

    @strawberry.field(description="Days and calls from one date to another (at most two months)")
    def schedule(
        self, info: GInfo, show_id: strawberry.ID, from_date: str | None = None, to_date: str | None = None
    ) -> list[ScheduleDay]:
        c = info.context
        view = schedule_service.get_schedule(c.ctx, c.principal.user, c.show_id(show_id), from_date, to_date)
        return [_build(ScheduleDay, d, calls=[_call(call) for call in d.calls]) for d in view.days]

    @strawberry.field(description="Every scene ranked for one night: fewest conflicts, then least rehearsed")
    def suggest_scenes(
        self,
        info: GInfo,
        show_id: strawberry.ID,
        date: str,
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> list[SceneSuggestion]:
        c = info.context
        result = schedule_service.suggest_scenes(
            c.ctx, c.principal.user, c.show_id(show_id), date, from_date, to_date
        )
        return [
            _build(SceneSuggestion, s, warnings=[_build(Warning, w) for w in s.warnings])
            for s in result.scenes
        ]

    @strawberry.field
    def callboard(self, info: GInfo, show_id: strawberry.ID) -> list[Notice]:
        c = info.context
        board = callboard_service.get_callboard(c.ctx, c.principal.user, c.show_id(show_id))
        return [_build(Notice, n) for n in board.notices]


# ---- Mutation ----------------------------------------------------------------------------------------


@strawberry.type
class Mutation:
    @strawberry.mutation(description="Adds a scene to a night, making that night's call if there isn't one")
    def add_scene_to_night(
        self, info: GInfo, show_id: strawberry.ID, date: str, scene_id: str, call_id: str | None = None
    ) -> strawberry.ID:
        c = info.context
        c.principal.require_write()
        call = schedule_service.add_scene(
            c.ctx,
            c.principal.user,
            c.show_id(show_id),
            date,
            schedule_service.AddSceneBody(scene_id=scene_id, call_id=call_id),
        )
        return strawberry.ID(call.call_id)

    @strawberry.mutation(description="Removes a call, or cancels it if it was already published")
    def delete_call(self, info: GInfo, show_id: strawberry.ID, call_id: str) -> bool:
        c = info.context
        c.principal.require_write()
        schedule_service.delete_call(c.ctx, c.principal.user, c.show_id(show_id), call_id)
        return True

    @strawberry.mutation(description="Publishes every call from one date to another and emails the changes")
    def publish(self, info: GInfo, show_id: strawberry.ID, from_date: str, to_date: str) -> PublishResult:
        c = info.context
        c.principal.require_write()
        body = schedule_service.PublishBody.model_validate({"from": from_date, "to": to_date})
        return _build(
            PublishResult, schedule_service.publish(c.ctx, c.principal.user, c.show_id(show_id), body)
        )

    @strawberry.mutation
    def post_notice(
        self,
        info: GInfo,
        show_id: strawberry.ID,
        title: str,
        body: str,
        audience: str = "everyone",
        pinned: bool = False,
        email: bool = True,
    ) -> strawberry.ID:
        c = info.context
        c.principal.require_write()
        notice = callboard_service.post_notice(
            c.ctx,
            c.principal.user,
            c.show_id(show_id),
            callboard_service.PostNoticeBody.model_validate(
                {"title": title, "body": body, "audience": audience, "pinned": pinned, "email": email}
            ),
        )
        return strawberry.ID(notice.notice_id)


class _ServiceErrors(strawberry.extensions.SchemaExtension):
    """Service errors come back as plain messages in GraphQL errors, like the REST error field."""

    def on_execute(self) -> Any:
        yield
        result = self.execution_context.result
        if result and result.errors:
            for error in result.errors:
                original = error.original_error
                if isinstance(original, ServiceError):
                    error.message = original.message
                    error.extensions = {"status": original.status}


schema = strawberry.Schema(query=Query, mutation=Mutation, extensions=[_ServiceErrors])


def graphql_router(ctx: Ctx) -> GraphQLRouter[GqlContext, None]:
    def context(request: Request) -> GqlContext:
        return GqlContext(ctx=ctx, principal=principal_for(ctx, request.headers.get("authorization")))

    return GraphQLRouter(schema, context_getter=context, graphql_ide=None)
