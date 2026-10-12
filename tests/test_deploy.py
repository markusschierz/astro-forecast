import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import os
import subprocess
import shlex

spec = importlib.util.spec_from_file_location("deploy_test", Path(__file__).resolve().parents[1] / "scripts/deploy_test.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class DeploymentTests(unittest.TestCase):
    def env(self, **overrides):
        return {
            "SFTP_HOST": "example.hostpoint.ch", "SFTP_USER": "test_user",
            "SFTP_PRIVATE_KEY": "fixture-private-key", "SFTP_REMOTE_DIR": "/www/test.astro-foto.ch",
            "APP_PATH": "/astro-forecast", "SITE_URL": "https://test.astro-foto.ch",
            "SFTP_KNOWN_HOSTS": "fixture-host-key", "GITHUB_SHA": "a" * 40,
            **overrides,
        }

    def test_valid_configuration_defaults_to_port_22(self):
        self.assertEqual(deploy.configuration(self.env())[3], 22)

    def test_missing_secrets_fail_before_network_access(self):
        for key in ("SFTP_HOST", "SFTP_USER", "SFTP_PRIVATE_KEY", "SFTP_REMOTE_DIR", "SFTP_KNOWN_HOSTS", "SITE_URL", "APP_PATH"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                deploy.configuration(self.env(**{key: ""}))

    def test_wrong_or_injected_remote_paths_are_rejected(self):
        for path in ("/www/astro-forecast", "/www/../site", "/www/site\nrm x", "www/site"):
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

    def test_key_authentication_and_optional_passphrase_without_network(self):
        for passphrase in ("", "fixture-passphrase"):
            with self.subTest(encrypted=bool(passphrase)), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                for path in deploy.FILES:
                    target = root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text("fixture")
                def inspect_call(args, **kwargs):
                    if args[0] == "ssh-keygen":
                        return subprocess.CompletedProcess(args, 0)
                    self.assertEqual(args[0], "sftp")
                    self.assertIn("-oPreferredAuthentications=publickey", args)
                    self.assertIn("-oPasswordAuthentication=no", args)
                    self.assertIn("-oKbdInteractiveAuthentication=no", args)
                    self.assertIn("-oIdentitiesOnly=yes", args)
                    key = Path(args[args.index("-i") + 1])
                    self.assertEqual(key.read_text(), "fixture-private-key\n")
                    self.assertEqual(key.stat().st_mode & 0o777, 0o600)
                    if passphrase:
                        self.assertEqual(kwargs["env"]["SSH_ASKPASS_REQUIRE"], "force")
                        self.assertTrue(Path(kwargs["env"]["SSH_ASKPASS"]).is_file())
                    else:
                        self.assertIn("-oBatchMode=yes", args)
                with patch.object(deploy, "ROOT", root), patch.dict(
                    deploy.os.environ, self.env(SFTP_KEY_PASSPHRASE=passphrase), clear=True
                ), patch.object(deploy.subprocess, "run", side_effect=inspect_call) as transfer, patch.object(
                    deploy, "verify_public_files"
                ) as verify:
                    deploy.main()
                    self.assertEqual(transfer.call_count, 2)
                    verify.assert_called_once_with("a" * 40, "https://test.astro-foto.ch/astro-forecast")


    def test_real_openssh_batch_mode_allows_passphrase(self):
        # Capture SSH's effective config through real sftp; no connection is made.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = root / "config"
            shim = root / "ssh"
            shim.write_text('#!/bin/sh\nexec ssh -G "$@" > ' + shlex.quote(str(config)) + '\n')
            shim.chmod(0o700)
            batch = root / "batch"
            batch.write_text("quit\n")
            for encrypted in (True, False):
                command = deploy.sftp_command(batch, root / "key", 22, root / "known_hosts", "test", "example.invalid", encrypted)
                subprocess.run(command[:1] + ["-S", str(shim)] + command[1:], capture_output=True, timeout=10)
                self.assertIn("batchmode " + ("no" if encrypted else "yes") + "\n", config.read_text())

    def test_real_encrypted_key_preflight(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            key = root / "key"
            phrase = "fixture passphrase $ with spaces"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", phrase, "-f", str(key)], check=True)
            askpass = root / "askpass"
            askpass.write_text("#!/bin/sh\nprintf '%s\\n' \"$SFTP_KEY_PASSPHRASE\"\n")
            askpass.chmod(0o700)
            env = {**os.environ, "SSH_ASKPASS": str(askpass), "SSH_ASKPASS_REQUIRE": "force", "DISPLAY": "test"}
            deploy.validate_private_key(key, {**env, "SFTP_KEY_PASSPHRASE": phrase})
            for wrong in ("wrong", ""):
                with self.assertRaisesRegex(ValueError, "Cannot unlock"):
                    deploy.validate_private_key(key, {**env, "SFTP_KEY_PASSPHRASE": wrong})
            key.write_text("invalid private key\n")
            with self.assertRaisesRegex(ValueError, "Cannot unlock"):
                deploy.validate_private_key(key, env)

    def test_website_and_app_paths_are_combined_once(self):
        for base, expected in (
            ("/www/test.astro-foto.ch", "/www/test.astro-foto.ch/astro-forecast"),
            ("~/www/test.astro-foto.ch", "www/test.astro-foto.ch/astro-forecast"),
            ("/www/astro-foto.ch/", "/www/astro-foto.ch/astro-forecast"),
        ):
            with self.subTest(base=base):
                self.assertEqual(deploy.configuration(self.env(SFTP_REMOTE_DIR=base))[2], expected)

    def test_public_url_comes_from_environment(self):
        cfg = deploy.configuration(self.env(SITE_URL="https://astro-foto.ch/"))
        self.assertEqual(cfg[5], "https://astro-foto.ch/astro-forecast")

    def test_invalid_app_path_and_site_url_are_rejected(self):
        for values in (
            {"APP_PATH": "/"}, {"APP_PATH": "/../astro-forecast"},
            {"SITE_URL": "http://astro-foto.ch"}, {"SITE_URL": "https://astro-foto.ch/other"},
            {"SITE_URL": "https://user:pass@astro-foto.ch"}, {"SITE_URL": "https://astro-foto.ch?x=1"},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                deploy.configuration(self.env(**values))

    def test_explicit_tested_revision_overrides_workflow_revision(self):
        self.assertEqual(deploy.configuration(self.env(DEPLOY_SHA="b" * 40))[4], "b" * 40)

if __name__ == "__main__":
    unittest.main()
