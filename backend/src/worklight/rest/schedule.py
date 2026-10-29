from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from worklight.models import Call, CheckIn, Model, User
from worklight.rest import UserDep
from worklight.services import schedule as service
from worklight.services import tech
from worklight.services.base import Ctx, IsoDate

From = Annotated[IsoDate | None, Query(alias="from")]
To = Annotated[IsoDate | None, Query(alias="to")]


class DoorCode(Model):
    door_code: str


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    # ---- schedule ----

    @r.get("/shows/{show_id}/schedule", response_model=service.ScheduleView, response_model_exclude_none=True)
    def get_schedule(
        show_id: str, user: CurrentUser, start: From = None, end: To = None
    ) -> service.ScheduleView:
        return service.get_schedule(ctx, user, show_id, start, end)

    @r.get(
        "/shows/{show_id}/schedule/suggestions",
        response_model=service.Suggestions,
        response_model_exclude_none=True,
    )
    def suggest(
        show_id: str, user: CurrentUser, date: IsoDate, start: From = None, end: To = None
    ) -> service.Suggestions:
        return service.suggest_scenes(ctx, user, show_id, date, start, end)

    @r.post("/shows/{show_id}/schedule/publish", response_model=service.PublishResult)
    def publish(show_id: str, user: CurrentUser, body: service.PublishBody) -> service.PublishResult:
        return service.publish(ctx, user, show_id, body)

    @r.post("/shows/{show_id}/schedule/{day}/scenes", response_model=Call, response_model_exclude_none=True)
    def add_scene(show_id: str, day: IsoDate, user: CurrentUser, body: service.AddSceneBody) -> Call:
        return service.add_scene(ctx, user, show_id, day, body)

    @r.post("/shows/{show_id}/calls", status_code=201, response_model=Call, response_model_exclude_none=True)
    def create_call(show_id: str, user: CurrentUser, body: service.CreateCallBody) -> Call:
        return service.create_call(ctx, user, show_id, body)

    @r.patch("/shows/{show_id}/calls/{call_id}", response_model=Call, response_model_exclude_none=True)
    def update_call(show_id: str, call_id: str, user: CurrentUser, body: service.UpdateCallBody) -> Call:
        return service.update_call(ctx, user, show_id, call_id, body)

    @r.delete("/shows/{show_id}/calls/{call_id}", status_code=204)
    def delete_call(show_id: str, call_id: str, user: CurrentUser) -> Response:
        service.delete_call(ctx, user, show_id, call_id)
        return Response(status_code=204)

    @r.post(
        "/shows/{show_id}/tech-calls",
        status_code=201,
        response_model=list[Call],
        response_model_exclude_none=True,
    )
    def tech_calls(show_id: str, user: CurrentUser, body: service.TechCallsBody) -> list[Call]:
        return service.create_tech_calls(ctx, user, show_id, body)

    @r.get("/me/calls", response_model=list[service.MyCall], response_model_exclude_none=True)
    def my_calls(
        user: CurrentUser, show_id: Annotated[str | None, Query(alias="showId")] = None
    ) -> list[service.MyCall]:
        return service.my_calls(ctx, user, show_id)

    # ---- tech week ----

    @r.get("/shows/{show_id}/attendance", response_model=tech.Attendance, response_model_exclude_none=True)
    def attendance(show_id: str, user: CurrentUser) -> tech.Attendance:
        return tech.get_attendance(ctx, user, show_id)

    @r.put(
        "/shows/{show_id}/attendance/{day}/{user_id}",
        response_model=CheckIn | None,
        response_model_exclude_none=True,
    )
    def mark(
        show_id: str, day: IsoDate, user_id: str, user: CurrentUser, body: tech.MarkBody
    ) -> CheckIn | None:
        return tech.mark(ctx, user, show_id, day, user_id, body)

    @r.post("/shows/{show_id}/door-code", response_model=DoorCode)
    def rotate(show_id: str, user: CurrentUser) -> DoorCode:
        return DoorCode(door_code=tech.rotate_door_code(ctx, user, show_id))

    @r.post("/shows/{show_id}/check-in", response_model=tech.CheckInResult, response_model_exclude_none=True)
    def check_in(show_id: str, user: CurrentUser, body: tech.CheckInBody) -> tech.CheckInResult:
        return tech.self_check_in(ctx, user, show_id, body)

    @r.post("/shows/{show_id}/running-late", response_model=CheckIn, response_model_exclude_none=True)
    def running_late(show_id: str, user: CurrentUser, body: tech.RunningLateBody) -> CheckIn:
        return tech.running_late(ctx, user, show_id, body)

    return r
