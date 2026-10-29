from typing import Annotated

from fastapi import APIRouter, Depends

from worklight.models import Show, ShowView, User
from worklight.rest import UserDep
from worklight.services import shows as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep) -> APIRouter:
    r = APIRouter(prefix="/api/shows/{show_id}")
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("", response_model=ShowView, response_model_exclude_none=True)
    def get_show(show_id: str, user: CurrentUser) -> ShowView:
        return service.get_show(ctx, user, show_id)

    @r.patch("", response_model=Show, response_model_exclude_none=True)
    def update_show(show_id: str, user: CurrentUser, body: service.UpdateShowBody) -> Show:
        return service.update_show(ctx, user, show_id, body)

    @r.post("/archive", response_model=Show, response_model_exclude_none=True)
    def archive_show(show_id: str, user: CurrentUser) -> Show:
        return service.set_archived(ctx, user, show_id, True)

    @r.post("/restore", response_model=Show, response_model_exclude_none=True)
    def restore_show(show_id: str, user: CurrentUser) -> Show:
        return service.set_archived(ctx, user, show_id, False)

    return r
