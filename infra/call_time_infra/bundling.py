"""Builds the backend Lambda bundle with uv on the machine running `cdk synth`, so no Docker is needed."""

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import jsii
from aws_cdk import ILocalBundling

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"
PYTHON_VERSION = "3.13"


def backend_hash() -> str:
    """Changes whenever the backend source or the locked dependencies change."""
    digest = hashlib.sha256((REPO_ROOT / "uv.lock").read_bytes())
    for path in sorted((BACKEND / "src").rglob("*.py")):
        digest.update(str(path.relative_to(BACKEND)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


@jsii.implements(ILocalBundling)
class UvBundling:
    """Installs locked dependencies as arm64 Linux wheels, then copies in the call_time package."""

    def try_bundle(self, output_dir: str, *_args: Any, **_kwargs: Any) -> bool:
        if shutil.which("uv") is None:
            raise RuntimeError("Bundling the backend needs uv: https://docs.astral.sh/uv/")
        with tempfile.TemporaryDirectory() as tmp:
            requirements = Path(tmp) / "requirements.txt"
            subprocess.run(
                [
                    "uv",
                    "export",
                    "--package",
                    "call-time-backend",
                    "--no-dev",
                    "--no-emit-workspace",
                    "--no-hashes",
                    "--frozen",
                    "--quiet",
                    "--output-file",
                    str(requirements),
                ],
                cwd=REPO_ROOT,
                check=True,
            )
            subprocess.run(
                [
                    "uv",
                    "pip",
                    "install",
                    "--quiet",
                    "--requirement",
                    str(requirements),
                    "--target",
                    output_dir,
                    "--python-platform",
                    "aarch64-manylinux2014",
                    "--python-version",
                    PYTHON_VERSION,
                    "--only-binary",
                    ":all:",
                ],
                cwd=REPO_ROOT,
                check=True,
            )
        shutil.copytree(
            BACKEND / "src" / "call_time",
            Path(output_dir) / "call_time",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            dirs_exist_ok=True,
        )
        return True
