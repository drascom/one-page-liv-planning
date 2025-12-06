from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _run_git_command(*args: str) -> str:
    """Return trimmed git command output or an empty string on failure."""
    try:
        output = subprocess.check_output(
            ["git", *args],
            cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""
    return output.decode().strip()


@lru_cache(maxsize=1)
def get_app_version() -> str:
    """
    Return a monotonically increasing version string.

    Prefers an explicit APP_VERSION env var, otherwise falls back to the git
    commit count (which increases each push) and short SHA. When git metadata is
    unavailable we emit a dev sentinel instead of failing startup.
    """
    env_version = os.environ.get("APP_VERSION")
    if env_version:
        return env_version

    commit_count = _run_git_command("rev-list", "--count", "HEAD")
    short_sha = _run_git_command("rev-parse", "--short", "HEAD")
    if commit_count and short_sha:
        return f"{commit_count}.{short_sha}"
    if commit_count:
        return commit_count
    if short_sha:
        return short_sha
    return "dev"
