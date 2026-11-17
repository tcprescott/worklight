from typing import Annotated

from fastapi import APIRouter, Depends

from worklight.models import Admin, Me, Show, Theater, TheaterView, User
from worklight.rest import UserDep
from worklight.services import accounts
from worklight.services import shows as show_service
from worklight.services import theaters as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("/me", response_model=Me, response_model_exclude_none=True)
    def get_me(user: CurrentUser) -> Me:
        return accounts.get_me(ctx, user)

    @r.patch("/me", response_model=User, response_model_exclude_none=True)
    def update_me(user: CurrentUser, body: accounts.UpdateMeBody) -> User:
        return accounts.update_me(ctx, user, body)

    @r.post("/theaters", status_code=201, response_model=Theater, response_model_exclude_none=True)
    def create_theater(user: CurrentUser, body: service.CreateTheaterBody) -> Theater:
        return service.create_theater(ctx, user, body)

    @r.get("/theaters/{theater_id}", response_model=TheaterView, response_model_exclude_none=True)
    def get_theater(theater_id: str, user: CurrentUser) -> TheaterView:
        return service.get_theater(ctx, user, theater_id)

    @r.post("/theaters/{theater_id}/admins", response_model=list[Admin], response_model_exclude_none=True)
    def add_admin(theater_id: str, user: CurrentUser, body: service.AddAdminBody) -> list[Admin]:
        return service.add_admin(ctx, user, theater_id, body)

    @r.delete(
        "/theaters/{theater_id}/admins/{admin_id}",
        response_model=list[Admin],
        response_model_exclude_none=True,
    )
    def remove_admin(theater_id: str, admin_id: str, user: CurrentUser) -> list[Admin]:
        return service.remove_admin(ctx, user, theater_id, admin_id)

    @r.post(
        "/theaters/{theater_id}/shows", status_code=201, response_model=Show, response_model_exclude_none=True
    )
    def create_show(theater_id: str, user: CurrentUser, body: show_service.CreateShowBody) -> Show:
        return show_service.create_show(ctx, user, theater_id, body)

    return r
