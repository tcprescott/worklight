from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import LineNote, LineNoteSet, User
from worklight.rest import UserDep
from worklight.services import linenotes
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    @r.get("/shows/{show_id}/notes", response_model=linenotes.LineNotesHome, response_model_exclude_none=True)
    def get_home(show_id: str, user: CurrentUser) -> linenotes.LineNotesHome:
        return linenotes.get_home(ctx, user, show_id)

    @r.post(
        "/shows/{show_id}/notes",
        status_code=201,
        response_model=LineNoteSet,
        response_model_exclude_none=True,
    )
    def create_set(show_id: str, user: CurrentUser, body: linenotes.CreateSetBody) -> LineNoteSet:
        return linenotes.create_set(ctx, user, show_id, body)

    @r.get(
        "/shows/{show_id}/notes/{set_id}",
        response_model=linenotes.LineNoteSetDetail,
        response_model_exclude_none=True,
    )
    def get_set(show_id: str, set_id: str, user: CurrentUser) -> linenotes.LineNoteSetDetail:
        return linenotes.get_set(ctx, user, show_id, set_id)

    @r.patch("/shows/{show_id}/notes/{set_id}", response_model=LineNoteSet, response_model_exclude_none=True)
    def update_set(
        show_id: str, set_id: str, user: CurrentUser, body: linenotes.UpdateSetBody
    ) -> LineNoteSet:
        return linenotes.update_set(ctx, user, show_id, set_id, body)

    @r.delete("/shows/{show_id}/notes/{set_id}", status_code=204)
    def delete_set(show_id: str, set_id: str, user: CurrentUser) -> Response:
        linenotes.delete_set(ctx, user, show_id, set_id)
        return Response(status_code=204)

    @r.post(
        "/shows/{show_id}/notes/{set_id}/notes",
        status_code=201,
        response_model=list[LineNote],
        response_model_exclude_none=True,
    )
    def add_notes(
        show_id: str, set_id: str, user: CurrentUser, body: linenotes.AddNotesBody
    ) -> list[LineNote]:
        return linenotes.add_notes(ctx, user, show_id, set_id, body)

    @r.patch(
        "/shows/{show_id}/notes/{set_id}/notes/{note_id}",
        response_model=LineNote,
        response_model_exclude_none=True,
    )
    def update_note(
        show_id: str, set_id: str, note_id: str, user: CurrentUser, body: linenotes.UpdateNoteBody
    ) -> LineNote:
        return linenotes.update_note(ctx, user, show_id, set_id, note_id, body)

    @r.delete("/shows/{show_id}/notes/{set_id}/notes/{note_id}", status_code=204)
    def delete_note(show_id: str, set_id: str, note_id: str, user: CurrentUser) -> Response:
        linenotes.delete_note(ctx, user, show_id, set_id, note_id)
        return Response(status_code=204)

    @r.post(
        "/shows/{show_id}/notes/{set_id}/release",
        response_model=linenotes.ReleaseResult,
        response_model_exclude_none=True,
    )
    def release(show_id: str, set_id: str, user: CurrentUser) -> linenotes.ReleaseResult:
        return linenotes.release_set(ctx, user, show_id, set_id)

    return r
