from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import Notice, User
from worklight.rest import UserDep
from worklight.services import callboard, notify
from worklight.services.base import Ctx

ICS = "text/calendar; charset=utf-8"


def router(ctx: Ctx, current_user: UserDep) -> APIRouter:
    r = APIRouter(prefix="/api")
    CurrentUser = Annotated[User, Depends(current_user)]

    # ---- calendar ----

    @r.get("/me/calendar", response_model=notify.CalendarLinks)
    def calendar_links(user: CurrentUser) -> notify.CalendarLinks:
        return notify.calendar_links(ctx, user)

    @r.post("/me/calendar/rotate", response_model=notify.CalendarLinks)
    def rotate_calendar(user: CurrentUser) -> notify.CalendarLinks:
        return notify.calendar_links(ctx, user, rotate=True)

    @r.get("/me/calls/{call_id}.ics", response_class=Response)
    def call_ics(call_id: str, user: CurrentUser) -> Response:
        return Response(
            notify.call_ics(ctx, user, call_id),
            media_type=ICS,
            headers={"content-disposition": 'attachment; filename="call.ics"'},
        )

    @r.get("/public/calendar/{token}.ics", response_class=Response)
    def feed(token: str) -> Response:
        return Response(
            notify.feed(ctx, token), media_type=ICS, headers={"cache-control": "private, max-age=900"}
        )

    # ---- callboard ----

    @r.get("/shows/{show_id}/notices", response_model=callboard.Callboard, response_model_exclude_none=True)
    def get_callboard(show_id: str, user: CurrentUser) -> callboard.Callboard:
        return callboard.get_callboard(ctx, user, show_id)

    @r.post("/shows/{show_id}/notices", status_code=201, response_model=Notice)
    def post_notice(show_id: str, user: CurrentUser, body: callboard.PostNoticeBody) -> Notice:
        return callboard.post_notice(ctx, user, show_id, body)

    @r.patch("/shows/{show_id}/notices/{notice_id}", response_model=Notice)
    def update_notice(
        show_id: str, notice_id: str, user: CurrentUser, body: callboard.UpdateNoticeBody
    ) -> Notice:
        return callboard.update_notice(ctx, user, show_id, notice_id, body)

    @r.delete("/shows/{show_id}/notices/{notice_id}", status_code=204)
    def delete_notice(show_id: str, notice_id: str, user: CurrentUser) -> Response:
        callboard.delete_notice(ctx, user, show_id, notice_id)
        return Response(status_code=204)

    @r.post("/shows/{show_id}/notices/read", status_code=204)
    def mark_read(show_id: str, user: CurrentUser, body: callboard.MarkReadBody) -> Response:
        callboard.mark_read(ctx, user, show_id, body)
        return Response(status_code=204)

    return r
