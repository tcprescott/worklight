from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from worklight.models import User
from worklight.rest import UserDep
from worklight.services import measurements, stock, wardrobe
from worklight.services.base import Ctx, readable_show
from worklight.services.photo_uploads import Photo, save_photo

# A picture is sent as the raw request body: image/jpeg, image/png or image/webp, at most 4 MB.
PICTURE = {
    "requestBody": {
        "required": True,
        "content": {
            t: {"schema": {"type": "string", "format": "binary"}} for t in ("image/jpeg", "image/png")
        },
    }
}


def router(ctx: Ctx, current_user: UserDep, base: str = "/api") -> APIRouter:
    r = APIRouter(prefix=base)
    CurrentUser = Annotated[User, Depends(current_user)]

    # ---- a show's tracker ----

    @r.get("/shows/{show_id}/wardrobe", response_model=wardrobe.Tracker, response_model_exclude_none=True)
    def get_tracker(show_id: str, user: CurrentUser) -> wardrobe.Tracker:
        return wardrobe.get_tracker(ctx, user, show_id)

    @r.post(
        "/shows/{show_id}/wardrobe/items",
        status_code=201,
        response_model=wardrobe.ItemView,
        response_model_exclude_none=True,
    )
    def create_item(show_id: str, user: CurrentUser, body: wardrobe.CreateItemBody) -> wardrobe.ItemView:
        return wardrobe.create_item(ctx, user, show_id, body)

    @r.patch(
        "/shows/{show_id}/wardrobe/items/{item_id}",
        response_model=wardrobe.ItemView,
        response_model_exclude_none=True,
    )
    def update_item(
        show_id: str, item_id: str, user: CurrentUser, body: wardrobe.UpdateItemBody
    ) -> wardrobe.ItemView:
        return wardrobe.update_item(ctx, user, show_id, item_id, body)

    @r.delete("/shows/{show_id}/wardrobe/items/{item_id}", status_code=204)
    def delete_item(show_id: str, item_id: str, user: CurrentUser) -> Response:
        wardrobe.delete_item(ctx, user, show_id, item_id)
        return Response(status_code=204)

    @r.post(
        "/shows/{show_id}/wardrobe/pull",
        status_code=201,
        response_model=wardrobe.ItemView,
        response_model_exclude_none=True,
    )
    def pull(show_id: str, user: CurrentUser, body: wardrobe.PullBody) -> wardrobe.ItemView:
        return wardrobe.pull_from_stock(ctx, user, show_id, body)

    @r.get(
        "/shows/{show_id}/wardrobe/mine", response_model=wardrobe.MyItems, response_model_exclude_none=True
    )
    def my_items(show_id: str, user: CurrentUser) -> wardrobe.MyItems:
        return wardrobe.my_items(ctx, user, show_id)

    @r.post("/shows/{show_id}/photos", status_code=201, response_model=Photo, openapi_extra=PICTURE)
    async def upload_show_photo(show_id: str, user: CurrentUser, request: Request) -> Photo:
        """Anyone in the show can add a picture (cast add costume ideas); it's only kept once it's put on
        an item or a measurement form."""
        data = await request.body()
        access = readable_show(ctx, show_id, user).require_open()
        return save_photo(ctx, access.show.theater_id, data)

    # ---- measurements ----

    @r.get(
        "/shows/{show_id}/measurements",
        response_model=list[measurements.SheetRow],
        response_model_exclude_none=True,
    )
    def list_sheets(show_id: str, user: CurrentUser) -> list[measurements.SheetRow]:
        return measurements.list_sheets(ctx, user, show_id)

    @r.get(
        "/shows/{show_id}/measurements/{user_id}",
        response_model=measurements.MeasurementSheet,
        response_model_exclude_none=True,
    )
    def get_sheet(show_id: str, user_id: str, user: CurrentUser) -> measurements.MeasurementSheet:
        return measurements.get_sheet(ctx, user, show_id, user_id)

    @r.patch(
        "/shows/{show_id}/measurements/{user_id}",
        response_model=measurements.MeasurementSheet,
        response_model_exclude_none=True,
    )
    def save_sheet(
        show_id: str, user_id: str, user: CurrentUser, body: measurements.SaveSheetBody
    ) -> measurements.MeasurementSheet:
        return measurements.save_sheet(ctx, user, show_id, user_id, body)

    # ---- company stock ----

    @r.get("/theaters/{theater_id}/stock", response_model=stock.Stock, response_model_exclude_none=True)
    def get_stock(theater_id: str, user: CurrentUser) -> stock.Stock:
        return stock.get_stock(ctx, user, theater_id)

    @r.post(
        "/theaters/{theater_id}/stock",
        status_code=201,
        response_model=stock.StockItemView,
        response_model_exclude_none=True,
    )
    def create_stock(theater_id: str, user: CurrentUser, body: stock.CreateStockBody) -> stock.StockItemView:
        return stock.create_stock(ctx, user, theater_id, body)

    @r.patch(
        "/theaters/{theater_id}/stock/{item_id}",
        response_model=stock.StockItemView,
        response_model_exclude_none=True,
    )
    def update_stock(
        theater_id: str, item_id: str, user: CurrentUser, body: stock.UpdateStockBody
    ) -> stock.StockItemView:
        return stock.update_stock(ctx, user, theater_id, item_id, body)

    @r.delete("/theaters/{theater_id}/stock/{item_id}", status_code=204)
    def delete_stock(theater_id: str, item_id: str, user: CurrentUser) -> Response:
        stock.delete_stock(ctx, user, theater_id, item_id)
        return Response(status_code=204)

    @r.post("/theaters/{theater_id}/photos", status_code=201, response_model=Photo, openapi_extra=PICTURE)
    async def upload_stock_photo(theater_id: str, user: CurrentUser, request: Request) -> Photo:
        return stock.upload_stock_photo(ctx, user, theater_id, await request.body())

    # ---- keepers ----

    @r.get(
        "/theaters/{theater_id}/keepers",
        response_model=list[stock.KeeperView],
        response_model_exclude_none=True,
    )
    def list_keepers(theater_id: str, user: CurrentUser) -> list[stock.KeeperView]:
        return stock.list_keepers(ctx, user, theater_id)

    @r.put(
        "/theaters/{theater_id}/keepers",
        response_model=list[stock.KeeperView],
        response_model_exclude_none=True,
    )
    def put_keeper(theater_id: str, user: CurrentUser, body: stock.PutKeeperBody) -> list[stock.KeeperView]:
        return stock.put_keeper(ctx, user, theater_id, body)

    @r.delete(
        "/theaters/{theater_id}/keepers/{user_id}",
        response_model=list[stock.KeeperView],
        response_model_exclude_none=True,
    )
    def remove_keeper(theater_id: str, user_id: str, user: CurrentUser) -> list[stock.KeeperView]:
        return stock.remove_keeper(ctx, user, theater_id, user_id)

    return r
