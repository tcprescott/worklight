from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import InviteAccepted, InvitePreview, InviteSent, Member, User
from worklight.rest import UserDep
from worklight.services import shows as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep) -> APIRouter:
    r = APIRouter(prefix="/api")
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("/shows/{show_id}/members", response_model=list[Member], response_model_exclude_none=True)
    def list_members(show_id: str, user: CurrentUser) -> list[Member]:
        return service.list_members(ctx, user, show_id)

    @r.patch("/shows/{show_id}/members/{member_id}", response_model=Member, response_model_exclude_none=True)
    def update_member(
        show_id: str, member_id: str, user: CurrentUser, body: service.UpdateMemberBody
    ) -> Member:
        return service.update_member(ctx, user, show_id, member_id, body)

    @r.delete("/shows/{show_id}/members/{member_id}", status_code=204)
    def remove_member(show_id: str, member_id: str, user: CurrentUser) -> Response:
        service.remove_member(ctx, user, show_id, member_id)
        return Response(status_code=204)

    @r.post(
        "/shows/{show_id}/invites",
        status_code=201,
        response_model=InviteSent,
        response_model_exclude_none=True,
    )
    def create_invite(show_id: str, user: CurrentUser, body: service.CreateInviteBody) -> InviteSent:
        return service.create_invite(ctx, user, show_id, body)

    @r.post("/shows/{show_id}/remind", response_model=service.Reminded)
    def remind(show_id: str, user: CurrentUser, body: service.RemindBody) -> service.Reminded:
        return service.remind(ctx, user, show_id, body)

    @r.post("/shows/{show_id}/join", response_model=InviteAccepted)
    def join_show(show_id: str, user: CurrentUser) -> InviteAccepted:
        return service.join_show(ctx, user, show_id)

    @r.post("/invites/{token}/accept", response_model=InviteAccepted, response_model_exclude_none=True)
    def accept_invite(token: str, user: CurrentUser) -> InviteAccepted:
        return service.accept_invite(ctx, user, token)

    # Public: no sign-in, so the invite link's sign-in page can say what the invite is for.
    @r.get("/public/invites/{token}", response_model=InvitePreview, response_model_exclude_none=True)
    def preview_invite(token: str) -> InvitePreview:
        return service.preview_invite(ctx, token)

    return r
