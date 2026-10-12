import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("resolve_test_run", Path(__file__).resolve().parents[1] / "scripts/resolve_test_run.py")
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

class PromotionTests(unittest.TestCase):
    def run_data(self):
        return dict(name="Deploy test", status="completed", conclusion="success", event="workflow_dispatch",
                    head_branch="main", head_sha="a" * 40,
                    path=".github/workflows/deploy-test.yml",
                    repository={"full_name": "markusschierz/astro-forecast"},
                    head_repository={"full_name": "markusschierz/astro-forecast"})

    def test_successful_manual_test_run_returns_exact_sha(self):
        self.assertEqual(resolver.tested_sha(self.run_data(), "markusschierz/astro-forecast"), "a" * 40)

    def test_non_test_failed_pending_fork_and_other_branch_runs_are_rejected(self):
        for key, value in (("name", "Deploy test.astro-foto.ch"), ("conclusion", "failure"), ("status", "in_progress"),
                           ("event", "pull_request"), ("head_branch", "feature"),
                           ("path", ".github/workflows/tests.yml"), ("head_sha", "main"),
                           ("repository", {"full_name": "other/repo"}),
                           ("head_repository", {"full_name": "other/repo"})):
            run = self.run_data()
            run[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                resolver.tested_sha(run, "markusschierz/astro-forecast")

if __name__ == "__main__":
    unittest.main()
