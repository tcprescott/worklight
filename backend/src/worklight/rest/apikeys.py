from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import ApiKey, User
from worklight.rest import UserDep
from worklight.services import apikeys as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base + "/theaters/{theater_id}/api-keys")
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("", response_model=list[ApiKey], response_model_exclude_none=True)
    def list_keys(theater_id: str, user: CurrentUser) -> list[ApiKey]:
        return service.list_keys(ctx, user, theater_id)

    @r.post("", status_code=201, response_model=service.NewApiKey, response_model_exclude_none=True)
    def create_key(theater_id: str, user: CurrentUser, body: service.CreateApiKeyBody) -> service.NewApiKey:
        return service.create_key(ctx, user, theater_id, body)

    @r.delete("/{key_id}", status_code=204)
    def revoke_key(theater_id: str, key_id: str, user: CurrentUser) -> Response:
        service.revoke_key(ctx, user, theater_id, key_id)
        return Response(status_code=204)

    return r
