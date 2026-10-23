"""Contributor docs, PR template, and issue forms stay complete and linked."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def test_pr_template_covers_required_sections_and_checks() -> None:
    template = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
    for expected in (
        "## Summary",
        "Closes #",
        "## Screenshots",
        "## Checks",
        "ruff check fretbook tests",
        "python -m pytest",
        "python -m fretbook.openapi --check",
        "npm run api-types:check",
        "API contract",
        "i18n",
        "Migrations",
    ):
        assert expected in template


def test_issue_templates_have_required_fields() -> None:
    templates_dir = ROOT / ".github" / "ISSUE_TEMPLATE"
    for filename, expected_label in (
        ("bug_report.yml", "bug"),
        ("feature_request.yml", "feature"),
    ):
        path = templates_dir / filename
        assert path.is_file(), f"Missing issue template: {filename}"
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert isinstance(data, dict)
        assert data.get("name")
        assert data.get("description")
        assert expected_label in data.get("labels", [])
        body = data.get("body", [])
        labels = [item.get("attributes", {}).get("label") for item in body if isinstance(item, dict)]
        assert labels == ["Context", "Goal", "Acceptance criteria", "Blocked by"]


def test_contributing_and_readme_link_templates_and_agent_guides() -> None:
    assert (ROOT / "AGENTS.md").is_file()
    assert (ROOT / "CLAUDE.md").is_file()
    assert (ROOT / "GEMINI.md").is_file()

    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
    assert "## Working on an issue" in contributing
    for link in (
        "AGENTS.md",
        ".github/pull_request_template.md",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/feature_request.yml",
    ):
        assert link in contributing

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    more_section = readme.split("## More", maxsplit=1)[1]
    for link in (
        "CONTRIBUTING.md",
        "AGENTS.md",
        "CLAUDE.md",
        ".github/pull_request_template.md",
        ".github/ISSUE_TEMPLATE/",
    ):
        assert link in more_section
