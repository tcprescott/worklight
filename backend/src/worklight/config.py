import os
from functools import cache

import boto3

from worklight.push import Pusher, WebPushChannel
from worklight.webpush import VapidKey, WebPushSender


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


@cache
def get_pusher() -> Pusher:
    """Web push, signed with the VAPID key in SSM. Push stays off when VAPID_KEY_PARAM isn't set.

    The key is made on first use and saved as a SecureString, so a deploy needs no manual step. Two cold
    starts racing both try to save; the loser reads the winner's key.
    """
    name = os.environ.get("VAPID_KEY_PARAM")
    if not name:
        return Pusher()
    ssm = boto3.client("ssm")
    try:
        pem = ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    except ssm.exceptions.ParameterNotFound:
        pem = VapidKey.generate().to_pem()
        try:
            ssm.put_parameter(
                Name=name,
                Value=pem,
                Type="SecureString",
                Overwrite=False,
                Description="Worklight web push (VAPID) private key. Replacing it ends every subscription.",
            )
        except ssm.exceptions.ParameterAlreadyExists:
            pem = ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    return Pusher([WebPushChannel(WebPushSender(VapidKey.from_pem(pem), require_env("FROM_EMAIL")))])
