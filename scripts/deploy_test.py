#!/usr/bin/env python3
"""Deploy the allowlisted app files via SFTP; never upload local configuration."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "styles.css", "app.js", "manifest.webmanifest",
    "icon-192.png", "icon-512.png",
    "api/.htaccess", "api/7timer.php", "api/meteoblue.php",
    "index.html", "sw.js",
)
PUBLIC_URL = "https://test.astro-foto.ch/astro-forecast"

def configuration(env):
    required = ("SFTP_HOST", "SFTP_USER", "SFTP_PRIVATE_KEY", "SFTP_REMOTE_DIR", "SFTP_KNOWN_HOSTS")
    missing = [key for key in required if not env.get(key, "").strip()]
    if missing:
        raise ValueError("Missing GitHub secrets: " + ", ".join(missing))
    host, user = env["SFTP_HOST"], env["SFTP_USER"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host):
        raise ValueError("SFTP_HOST must be a hostname")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", user):
        raise ValueError("SFTP_USER contains unsupported characters")
    remote = env["SFTP_REMOTE_DIR"].rstrip("/")
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", remote):
        raise ValueError("SFTP_REMOTE_DIR must be an absolute path without spaces")
    if ".." in PurePosixPath(remote).parts or PurePosixPath(remote).name != "astro-forecast":
        raise ValueError("SFTP_REMOTE_DIR must point directly to the astro-forecast directory")
    port = int(env.get("SFTP_PORT") or "22")
    if not 1 <= port <= 65535:
        raise ValueError("SFTP_PORT is out of range")
    revision = env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("GITHUB_SHA must be the checked-out commit SHA")
    return host, user, remote, port, revision

def batch_commands(remote, revision):
    # Stage every upload before replacing any live file. Config files are excluded.
    commands = [f'cd "{remote}"']
    for path in FILES:
        commands.append(f'put "{path}" "{path}.deploy-{revision}"')
    for path in FILES:
        commands.append(f'rename "{path}.deploy-{revision}" "{path}"')
    return "\n".join(commands) + "\n"

def verify_public_files(revision):
    for path in ("index.html", "app.js", "sw.js"):
        request = Request(f"{PUBLIC_URL}/{path}?deploy={revision}", headers={"Cache-Control": "no-cache"})
        with urlopen(request, timeout=30) as response:
            body = response.read()
        expected = (ROOT / path).read_bytes()
        if hashlib.sha256(body).digest() != hashlib.sha256(expected).digest():
            raise RuntimeError(f"Public verification failed for {path}")
    print("Public index.html, app.js and sw.js match the deployed commit.")

def main():
    host, user, remote, port, revision = configuration(os.environ)
    for path in FILES:
        if not (ROOT / path).is_file():
            raise ValueError(f"Missing deployment file: {path}")
    with tempfile.TemporaryDirectory(prefix="astro-deploy-") as temp:
        known_hosts = Path(temp) / "known_hosts"
        known_hosts.write_text(os.environ["SFTP_KNOWN_HOSTS"] + "\n")
        known_hosts.chmod(0o600)
        batch = Path(temp) / "upload.sftp"
        batch.write_text(batch_commands(remote, revision))
        private_key = Path(temp) / "id_deploy"
        private_key.write_text(os.environ["SFTP_PRIVATE_KEY"].rstrip() + "\n")
        private_key.chmod(0o600)
        child_env = os.environ.copy()
        passphrase = os.environ.get("SFTP_KEY_PASSPHRASE", "")
        if passphrase:
            askpass = Path(temp) / "askpass"
            askpass.write_text("#!/bin/sh\nprintf '%s\\n' \"$SFTP_KEY_PASSPHRASE\"\n")
            askpass.chmod(0o700)
            child_env["SSH_ASKPASS"] = str(askpass)
            child_env["SSH_ASKPASS_REQUIRE"] = "force"
            child_env["DISPLAY"] = "astro-deploy"
        subprocess.run([
            "sftp", "-b", str(batch), "-i", str(private_key),
            "-P", str(port), "-oBatchMode=" + ("no" if passphrase else "yes"),
            "-oIdentitiesOnly=yes", "-oIdentityAgent=none",
            "-oPreferredAuthentications=publickey",
            "-oPasswordAuthentication=no", "-oKbdInteractiveAuthentication=no",
            "-oStrictHostKeyChecking=yes",
            "-oUserKnownHostsFile=" + str(known_hosts),
            "-oConnectTimeout=15", user + "@" + host,
        ], cwd=ROOT, env=child_env, check=True, timeout=300)
    verify_public_files(revision)

if __name__ == "__main__":
    main()
