import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("resolve_test_run", Path(__file__).resolve().parents[1] / "scripts/resolve_test_run.py")
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

class PromotionTests(unittest.TestCase):
    def run_data(self):
        return dict(name="Deploy test", status="completed", conclusion="success", event="push",
                    head_branch="test", head_sha="a" * 40,
                    path=".github/workflows/deploy-test.yml",
                    repository={"full_name": "markusschierz/astro-forecast"},
                    head_repository={"full_name": "markusschierz/astro-forecast"})

    def test_successful_test_run_returns_exact_sha(self):
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

class TreePromotionTests(PromotionTests):
    def test_merge_commit_with_same_files_selects_tested_commit(self):
        run = self.run_data()
        def request(path):
            if "/runs?" in path:
                return {"workflow_runs": [run]}
            return {"tree": {"sha": "same-tree"}}
        self.assertEqual(resolver.resolve("markusschierz/astro-forecast", "b" * 40, request), "a" * 40)

    def test_new_untested_content_is_blocked(self):
        def request(path):
            if "/runs?" in path:
                return {"workflow_runs": [self.run_data()]}
            return {"tree": {"sha": path.rsplit("/", 1)[-1]}}
        with self.assertRaisesRegex(ValueError, "Production blocked"):
            resolver.resolve("markusschierz/astro-forecast", "b" * 40, request)

    def test_pagination_finds_older_matching_run(self):
        run = self.run_data()
        def request(path):
            if "/runs?" in path:
                if path.endswith("&page=1"):
                    return {"workflow_runs": [dict(run, head_sha="c" * 40)] * 100}
                return {"workflow_runs": [run]}
            return {"tree": {"sha": "different" if path.endswith("c" * 40) else "same"}}
        self.assertEqual(resolver.resolve("markusschierz/astro-forecast", "b" * 40, request), "a" * 40)

    def test_manual_retry_on_test_is_accepted(self):
        run = dict(self.run_data(), event="workflow_dispatch")
        self.assertEqual(resolver.tested_sha(run, "markusschierz/astro-forecast"), "a" * 40)

if __name__ == "__main__":
    unittest.main()
