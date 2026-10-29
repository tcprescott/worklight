"""Prints the API's OpenAPI schema. The web app generates its TypeScript types from it."""

import json

from call_time.app import AppDeps, create_app


def main() -> None:
    app = create_app(AppDeps(store=None, mailer=None, app_url=""))  # type: ignore[arg-type]
    print(json.dumps(app.openapi(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
