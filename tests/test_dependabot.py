"""Tests for Dependabot automated dependency update configuration."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEPENDABOT_PATH = ROOT / ".github" / "dependabot.yml"
REQUIREMENTS_PATH = ROOT / "requirements.txt"
PACKAGE_JSON_PATH = ROOT / "web" / "package.json"


def test_dependabot_config_structure() -> None:
    assert DEPENDABOT_PATH.is_file(), ".github/dependabot.yml must exist"
    raw = DEPENDABOT_PATH.read_text(encoding="utf-8")
    config = yaml.safe_load(raw)

    assert config["version"] == 2
    updates = config.get("updates", [])
    assert isinstance(updates, list)

    by_ecosystem = {entry["package-ecosystem"]: entry for entry in updates}
    assert set(by_ecosystem.keys()) == {"docker", "github-actions", "npm", "pip"}

    # Docker base image
    docker = by_ecosystem["docker"]
    assert docker["directory"] == "/"
    assert docker["schedule"]["interval"] == "weekly"
    assert "docker-base-images" in docker.get("groups", {})
    assert "*" in docker["groups"]["docker-base-images"]["patterns"]

    # GitHub Actions
    actions = by_ecosystem["github-actions"]
    assert actions["directory"] == "/"
    assert actions["schedule"]["interval"] == "weekly"
    assert "github-actions" in actions.get("groups", {})
    assert "*" in actions["groups"]["github-actions"]["patterns"]

    # npm (web/)
    npm = by_ecosystem["npm"]
    assert npm["directory"] == "/web"
    assert npm["schedule"]["interval"] == "weekly"
    npm_groups = npm.get("groups", {})
    assert "alphatab" in npm_groups
    alphatab_patterns = npm_groups["alphatab"]["patterns"]
    assert "@coderline/alphatab" in alphatab_patterns
    assert "@coderline/alphatab-vite" in alphatab_patterns
    assert "minor" in npm_groups["alphatab"]["update-types"]
    assert "patch" in npm_groups["alphatab"]["update-types"]
    assert "npm-dependencies" in npm_groups

    # pip
    pip = by_ecosystem["pip"]
    assert pip["directory"] == "/"
    # yt-dlp gets its own daily update
    assert pip["schedule"]["interval"] == "daily"
    pip_groups = pip.get("groups", {})
    assert "python-dependencies" in pip_groups
    assert "yt-dlp" in pip_groups["python-dependencies"]["exclude-patterns"]

    # Comments must document deliberate exact pins of fastapi and pydantic
    assert "fastapi" in raw
    assert "pydantic" in raw
    assert "openapi" in raw
    assert "api-types" in raw


def test_fastapi_and_pydantic_deliberately_pinned() -> None:
    content = REQUIREMENTS_PATH.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip() and not line.startswith("#")]
    pins = {}
    for line in lines:
        if "==" in line:
            pkg, ver = line.split("==", 1)
            pins[pkg] = ver

    assert "fastapi" in pins, "fastapi must be exactly pinned (==) to keep openapi.json stable"
    assert "pydantic" in pins, "pydantic must be exactly pinned (==) to keep openapi.json stable"


def test_alphatab_packages_pinned_in_web() -> None:
    pkg = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))
    alphatab_dep = pkg.get("dependencies", {}).get("@coderline/alphatab")
    alphatab_vite_dep = pkg.get("devDependencies", {}).get("@coderline/alphatab-vite")

    assert alphatab_dep is not None
    assert alphatab_vite_dep is not None
    # Pinned to exact matching version (no ^ or ~)
    assert not alphatab_dep.startswith(("^", "~", ">", "<"))
    assert not alphatab_vite_dep.startswith(("^", "~", ">", "<"))
    assert alphatab_dep == alphatab_vite_dep
