from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response

from worklight.models import Act, Breakdown, Character, Scene, User
from worklight.rest import UserDep
from worklight.services import breakdown as service
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep) -> APIRouter:
    r = APIRouter(prefix="/api/shows/{show_id}")
    CurrentUser = Annotated[User, Depends(current_user)]

    def no_content() -> Response:
        return Response(status_code=204)

    @r.get("/breakdown", response_model=Breakdown, response_model_exclude_none=True)
    def get_breakdown(show_id: str, user: CurrentUser) -> Breakdown:
        return service.get_breakdown(ctx, user, show_id)

    @r.post("/acts", status_code=201, response_model=Act)
    def create_act(show_id: str, user: CurrentUser, body: service.ActBody) -> Act:
        return service.create_act(ctx, user, show_id, body)

    @r.patch("/acts/{act_id}", response_model=Act)
    def update_act(show_id: str, act_id: str, user: CurrentUser, body: service.ActBody) -> Act:
        return service.update_act(ctx, user, show_id, act_id, body)

    @r.delete("/acts/{act_id}", status_code=204)
    def delete_act(show_id: str, act_id: str, user: CurrentUser) -> Response:
        service.delete_act(ctx, user, show_id, act_id)
        return no_content()

    @r.post("/scenes", status_code=201, response_model=Scene, response_model_exclude_none=True)
    def create_scene(show_id: str, user: CurrentUser, body: service.CreateSceneBody) -> Scene:
        return service.create_scene(ctx, user, show_id, body)

    @r.patch("/scenes/{scene_id}", response_model=Scene, response_model_exclude_none=True)
    def update_scene(show_id: str, scene_id: str, user: CurrentUser, body: service.UpdateSceneBody) -> Scene:
        return service.update_scene(ctx, user, show_id, scene_id, body)

    @r.delete("/scenes/{scene_id}", status_code=204)
    def delete_scene(show_id: str, scene_id: str, user: CurrentUser) -> Response:
        service.delete_scene(ctx, user, show_id, scene_id)
        return no_content()

    @r.put("/scenes/{scene_id}/characters/{char_id}", status_code=204)
    def add_to_scene(show_id: str, scene_id: str, char_id: str, user: CurrentUser) -> Response:
        service.set_appearance(ctx, user, show_id, scene_id, char_id, True)
        return no_content()

    @r.delete("/scenes/{scene_id}/characters/{char_id}", status_code=204)
    def remove_from_scene(show_id: str, scene_id: str, char_id: str, user: CurrentUser) -> Response:
        service.set_appearance(ctx, user, show_id, scene_id, char_id, False)
        return no_content()

    @r.post("/characters", status_code=201, response_model=Character)
    def create_character(show_id: str, user: CurrentUser, body: service.CreateCharacterBody) -> Character:
        return service.create_character(ctx, user, show_id, body)

    @r.patch("/characters/{char_id}", response_model=Character)
    def update_character(
        show_id: str, char_id: str, user: CurrentUser, body: service.UpdateCharacterBody
    ) -> Character:
        return service.update_character(ctx, user, show_id, char_id, body)

    @r.delete("/characters/{char_id}", status_code=204)
    def delete_character(show_id: str, char_id: str, user: CurrentUser) -> Response:
        service.delete_character(ctx, user, show_id, char_id)
        return no_content()

    @r.post("/reorder/{kind}", response_model=Breakdown, response_model_exclude_none=True)
    def reorder(
        show_id: str,
        kind: Literal["acts", "scenes", "characters"],
        user: CurrentUser,
        body: service.ReorderBody,
    ) -> Breakdown:
        return service.reorder(ctx, user, show_id, kind, body)

    return r
