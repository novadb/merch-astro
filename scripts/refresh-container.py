# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Brings the local container of this demo (http://localhost:4002) up to date.

Usage (from this folder):
  uv run scripts/refresh-container.py

Builds the image from the Dockerfile and starts the three containers of `compose.yaml` anew (~30 s; the pages are built
when they start, so a change to the source always needs a new image). The Delivery login (NOVA_DELIVERY_URL, NOVA_DELIVERY_USER, NOVA_DELIVERY_PASSWORD)
and the public Shopify Buy Button settings (SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN) come from the environment or from
`.env` (see `.env.example`), the environment winning; it stops if one is missing and never prints a value. Engine: podman, else docker.
"""
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = "merch-astro"
PORT = 4002
CHECK_URL = f"http://127.0.0.1:{PORT}/de/"


ENGINE = shutil.which("podman") or shutil.which("docker") or sys.exit("neither podman nor docker found on PATH")


LOGIN_VARS = ("NOVA_DELIVERY_URL", "NOVA_DELIVERY_USER", "NOVA_DELIVERY_PASSWORD", "SHOPIFY_DOMAIN", "SHOPIFY_STOREFRONT_TOKEN")


def login_env() -> dict[str, str]:
    """The Delivery login and the Shopify settings: the process environment wins over `.env` (KEY=value lines).
    Stops if one is missing; Shopify's two would otherwise leave the site without buy buttons and cart."""
    values: dict[str, str] = {}
    dotenv = ROOT / ".env"
    if dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in LOGIN_VARS:
                value = value.strip()
                if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                values[key.strip()] = value.replace("\\$", "$")  # an escaped dollar (`\$`) is a literal one, as the framework's .env files write it
    values.update({name: os.environ[name] for name in LOGIN_VARS if os.environ.get(name)})
    missing = [name for name in LOGIN_VARS if not values.get(name)]
    if missing:
        sys.exit(f"{', '.join(missing)} not set (environment or {dotenv})")
    return values


def run(*args: str, check: bool = True, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    print("$", " ".join(Path(args[0]).name if i == 0 else a for i, a in enumerate(args)))
    done = subprocess.run(args, cwd=ROOT, encoding="utf-8", check=False, env={**os.environ, **(env or {})})
    if check and done.returncode:
        sys.exit(f"failed with exit code {done.returncode}")
    return done


def wait_until_up() -> None:
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(CHECK_URL, timeout=5) as response:
                print(f"{CHECK_URL} -> {response.status}")
                return
        except OSError:
            time.sleep(1)
    sys.exit(f"{CHECK_URL} did not answer within 120 s: see `{Path(ENGINE).name} logs {NAME}`")


def refresh() -> None:
    login = login_env()
    compose = (ENGINE, "compose", "--project-name", NAME)
    # `--volumes`: the built pages start empty, as in a new pod
    run(*compose, "down", "--volumes", check=False)
    # The compose file names the variables; their values come from run()'s environment and never stand on a command line
    run(*compose, "up", "--detach", "--build", env={**login, "SITE_URL": f"http://localhost:{PORT}"})


if __name__ == "__main__":
    started = time.monotonic()
    refresh()
    wait_until_up()
    print(f"done in {time.monotonic() - started:.0f} s")
