from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response

from worklight.models import DateConflict, MemberConflicts, MyConflicts, User, WeeklyConflict
from worklight.rest import UserDep
from worklight.services import conflicts as service
from worklight.services.base import Ctx, IsoDate

Weekday = Annotated[int, Path(ge=0, le=6)]


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("/me/conflicts", response_model=MyConflicts, response_model_exclude_none=True)
    def get_my_conflicts(user: CurrentUser) -> MyConflicts:
        return service.get_my_conflicts(ctx, user)

    @r.post("/me/conflicts", response_model=MyConflicts, response_model_exclude_none=True)
    def save_conflicts(user: CurrentUser, body: service.SaveConflictsBody) -> MyConflicts:
        return service.save_conflicts(ctx, user, body)

    @r.put("/me/conflicts/weekly/{weekday}", response_model=WeeklyConflict, response_model_exclude_none=True)
    def put_weekly(weekday: Weekday, user: CurrentUser, body: service.WeeklyBody) -> WeeklyConflict:
        return service.put_weekly(ctx, user, weekday, body)

    @r.delete("/me/conflicts/weekly/{weekday}", status_code=204)
    def delete_weekly(weekday: Weekday, user: CurrentUser) -> Response:
        service.delete_weekly(ctx, user, weekday)
        return Response(status_code=204)

    @r.put("/me/conflicts/dates/{day}", response_model=DateConflict, response_model_exclude_none=True)
    def put_date(day: IsoDate, user: CurrentUser, body: service.DateBody) -> DateConflict:
        return service.put_date(ctx, user, day, body)

    @r.delete("/me/conflicts/dates/{day}", status_code=204)
    def delete_date(day: IsoDate, user: CurrentUser) -> Response:
        service.delete_date(ctx, user, day)
        return Response(status_code=204)

    @r.get("/me/days", response_model=list[service.ShowDayView], response_model_exclude_none=True)
    def my_days(user: CurrentUser) -> list[service.ShowDayView]:
        return service.my_days(ctx, user)

    @r.get(
        "/shows/{show_id}/conflicts", response_model=list[MemberConflicts], response_model_exclude_none=True
    )
    def show_conflicts(show_id: str, user: CurrentUser) -> list[MemberConflicts]:
        return service.show_conflicts(ctx, user, show_id)

    return r
