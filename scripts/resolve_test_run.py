#!/usr/bin/env python3
"""Resolve only successful manual test deployments from this repository/main."""
import json
import re
import sys

def tested_sha(run, repository):
    if (
        run.get("conclusion") != "success" or run.get("status") != "completed"
        or run.get("name") != "Deploy test" or run.get("event") != "workflow_dispatch" or run.get("head_branch") != "main"
        or run.get("path", "").split("@")[0] != ".github/workflows/deploy-test.yml"
        or run.get("repository", {}).get("full_name") != repository
        or run.get("head_repository", {}).get("full_name") != repository
    ):
        raise ValueError("Run must be a successful manual test deployment from this repository/main")
    sha = run.get("head_sha", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Test deployment has no valid commit SHA")
    return sha

if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        run = json.load(source)
    print(tested_sha(run, sys.argv[2]))
