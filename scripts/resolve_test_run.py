#!/usr/bin/env python3
"""Find a successful test deployment with exactly the production commit's tree."""
import json
import os
import re
import subprocess


def tested_sha(run, repository):
    if (
        run.get("conclusion") != "success" or run.get("status") != "completed"
        or run.get("name") != "Deploy test"
        or run.get("event") not in ("push", "workflow_dispatch")
        or run.get("head_branch") != "test"
        or run.get("path", "").split("@")[0] != ".github/workflows/deploy-test.yml"
        or run.get("repository", {}).get("full_name") != repository
        or run.get("head_repository", {}).get("full_name") != repository
    ):
        raise ValueError("Run must be a successful test deployment from this repository/test")
    sha = run.get("head_sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Test deployment has no valid commit SHA")
    return sha


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def resolve(repository, production_sha, request=api):
    if not re.fullmatch(r"[0-9a-f]{40}", production_sha):
        raise ValueError("Invalid production commit SHA")
    production_tree = request(f"repos/{repository}/git/commits/{production_sha}")["tree"]["sha"]
    # Paginate rather than accidentally selecting only the most recent test run.
    page = 1
    while True:
        runs = request(
            f"repos/{repository}/actions/workflows/deploy-test.yml/runs"
            f"?branch=test&status=success&per_page=100&page={page}"
        )["workflow_runs"]
        for run in runs:
            try:
                sha = tested_sha(run, repository)
            except ValueError:
                continue
            tree = request(f"repos/{repository}/git/commits/{sha}")["tree"]["sha"]
            if tree == production_tree:
                return sha
        if len(runs) < 100:
            raise ValueError("Production blocked: no successful test deployment has identical file contents")
        page += 1


if __name__ == "__main__":
    print(resolve(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]))
