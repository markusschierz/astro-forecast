import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("deploy_test", Path(__file__).resolve().parents[1] / "scripts/deploy_test.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeploymentTests(unittest.TestCase):
    def env(self, **overrides):
        return {
            "SFTP_HOST": "example.hostpoint.ch", "SFTP_USER": "test_user",
            "SFTP_PASSWORD": "fixture-password", "SFTP_REMOTE_DIR": "/www/test.astro-foto.ch/astro-forecast",
            "SFTP_KNOWN_HOSTS": "fixture-host-key", "GITHUB_SHA": "a" * 40,
            **overrides,
        }

    def test_valid_configuration_defaults_to_port_22(self):
        self.assertEqual(deploy.configuration(self.env())[3], 22)

    def test_missing_secrets_fail_before_network_access(self):
        for key in ("SFTP_HOST", "SFTP_USER", "SFTP_PASSWORD", "SFTP_REMOTE_DIR", "SFTP_KNOWN_HOSTS"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                deploy.configuration(self.env(**{key: ""}))

    def test_wrong_or_injected_remote_paths_are_rejected(self):
        for path in ("/www", "/www/astro-forecast/../astro-forecast", "/www/astro-forecast\nrm x", "/www/other-app"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                deploy.configuration(self.env(SFTP_REMOTE_DIR=path))

    def test_host_user_port_and_revision_are_validated(self):
        for values in ({"SFTP_HOST": "-bad"}, {"SFTP_USER": "user\ncommand"},
                       {"SFTP_PORT": "0"}, {"SFTP_PORT": "65536"}, {"GITHUB_SHA": "main"}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                deploy.configuration(self.env(**values))

    def test_allowlist_excludes_secrets_wordpress_and_development_files(self):
        self.assertEqual(len(deploy.FILES), 10)
        for path in deploy.FILES:
            self.assertNotIn("config", path)
            self.assertNotIn("wp-", path)
            self.assertNotIn("..", path)
        self.assertNotIn("dev_server.py", deploy.FILES)

    def test_all_uploads_precede_live_replacements(self):
        lines = deploy.batch_commands("/www/astro-forecast", "a" * 40).splitlines()
        uploads = [i for i, line in enumerate(lines) if line.startswith("put ")]
        renames = [i for i, line in enumerate(lines) if line.startswith("rename ")]
        self.assertEqual(len(uploads), len(deploy.FILES))
        self.assertEqual(len(renames), len(deploy.FILES))
        self.assertLess(max(uploads), min(renames))
        self.assertTrue(lines[-1].endswith('"sw.js"'))

if __name__ == "__main__":
    unittest.main()
