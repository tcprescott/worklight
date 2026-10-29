import os
from functools import cache

import boto3


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing environment variable {name}")
    return value


@cache
def get_app_url() -> str:
    """The public site URL for emailed links.

    Set APP_URL directly once a custom domain exists; until then the stack writes the CloudFront URL to SSM
    (an environment variable would make a dependency cycle).
    """
    if url := os.environ.get("APP_URL"):
        return url.rstrip("/")
    name = os.environ.get("APP_URL_PARAM")
    if not name:
        raise RuntimeError("Set APP_URL or APP_URL_PARAM")
    value = boto3.client("ssm").get_parameter(Name=name)["Parameter"].get("Value")
    if not value:
        raise RuntimeError(f"SSM parameter {name} is empty")
    return value.rstrip("/")
