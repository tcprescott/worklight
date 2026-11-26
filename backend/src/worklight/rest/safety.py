"""Safety info routes. Only for people signed in to the app: never served under /api/v1 to API keys,
nor through GraphQL or MCP."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import MemberMedical, SafetyAccessView, SafetyInfo, User
from worklight.rest import UserDep
from worklight.services import safety as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("/me/safety", response_model=SafetyInfo, response_model_exclude_none=True)
    def get_mine(user: CurrentUser) -> SafetyInfo:
        return service.get_mine(ctx, user)

    @r.put("/me/safety", response_model=SafetyInfo, response_model_exclude_none=True)
    def put_mine(user: CurrentUser, body: service.SafetyBody) -> SafetyInfo:
        return service.put_mine(ctx, user, body)

    @r.delete("/me/safety", status_code=204)
    def delete_mine(user: CurrentUser) -> Response:
        service.delete_mine(ctx, user)
        return Response(status_code=204)

    @r.get("/me/safety/views", response_model=list[SafetyAccessView], response_model_exclude_none=True)
    def my_views(user: CurrentUser) -> list[SafetyAccessView]:
        return service.my_views(ctx, user)

    @r.get("/shows/{show_id}/safety", response_model=service.ShowSafetyPage, response_model_exclude_none=True)
    def show_safety(show_id: str, user: CurrentUser) -> service.ShowSafetyPage:
        return service.show_safety(ctx, user, show_id)

    @r.get(
        "/shows/{show_id}/safety/{member_id}/medical",
        response_model=MemberMedical,
        response_model_exclude_none=True,
    )
    def member_medical(show_id: str, member_id: str, user: CurrentUser) -> MemberMedical:
        return service.member_medical(ctx, user, show_id, member_id)

    return r
