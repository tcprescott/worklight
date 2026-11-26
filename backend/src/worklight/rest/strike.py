from typing import Annotated

from fastapi import APIRouter, Depends, Response

from worklight.models import StrikeTask, User
from worklight.rest import UserDep
from worklight.services import strike
from worklight.services.base import Ctx


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    # ---- a show's checklist ----

    @r.get("/shows/{show_id}/strike", response_model=strike.StrikeChecklist, response_model_exclude_none=True)
    def get_checklist(show_id: str, user: CurrentUser) -> strike.StrikeChecklist:
        return strike.get_checklist(ctx, user, show_id)

    @r.post("/shows/{show_id}/strike/tasks", status_code=201, response_model=StrikeTask)
    def add_task(show_id: str, user: CurrentUser, body: strike.AddTaskBody) -> StrikeTask:
        return strike.add_task(ctx, user, show_id, body)

    @r.patch("/shows/{show_id}/strike/tasks/{task_id}", response_model=StrikeTask)
    def update_task(show_id: str, task_id: str, user: CurrentUser, body: strike.UpdateTaskBody) -> StrikeTask:
        return strike.update_task(ctx, user, show_id, task_id, body)

    @r.delete("/shows/{show_id}/strike/tasks/{task_id}", status_code=204)
    def delete_task(show_id: str, task_id: str, user: CurrentUser) -> Response:
        strike.delete_task(ctx, user, show_id, task_id)
        return Response(status_code=204)

    @r.post("/shows/{show_id}/strike/copy-template", response_model=strike.StrikeChecklist)
    def copy_template(show_id: str, user: CurrentUser) -> strike.StrikeChecklist:
        return strike.copy_template(ctx, user, show_id)

    # ---- the company template ----

    @r.get("/theaters/{theater_id}/strike-template", response_model=strike.StrikeTemplate)
    def get_template(theater_id: str, user: CurrentUser) -> strike.StrikeTemplate:
        return strike.get_template(ctx, user, theater_id)

    @r.put("/theaters/{theater_id}/strike-template", response_model=strike.StrikeTemplate)
    def put_template(
        theater_id: str, user: CurrentUser, body: strike.PutTemplateBody
    ) -> strike.StrikeTemplate:
        return strike.put_template(ctx, user, theater_id, body)

    return r
