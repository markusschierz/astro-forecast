#!/usr/bin/env python3
"""Deploy the allowlisted app files via SFTP; never upload local configuration."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "styles.css", "app.js", "manifest.webmanifest",
    "icon-192.png", "icon-512.png",
    "api/.htaccess", "api/7timer.php", "api/meteoblue.php",
    "index.html", "sw.js",
)

def configuration(env):
    required = ("SFTP_HOST", "SFTP_USER", "SFTP_PRIVATE_KEY", "SFTP_REMOTE_DIR", "SFTP_KNOWN_HOSTS", "SITE_URL", "APP_PATH")
    missing = [key for key in required if not env.get(key, "").strip()]
    if missing:
        raise ValueError("Missing deployment configuration: " + ", ".join(missing))
    host, user = env["SFTP_HOST"], env["SFTP_USER"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", host):
        raise ValueError("SFTP_HOST must be a hostname")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", user):
        raise ValueError("SFTP_USER contains unsupported characters")
    base = env["SFTP_REMOTE_DIR"].rstrip("/")
    # SFTP starts in the remote login directory; ~/ becomes a relative path.
    if base.startswith("~/"):
        base = base[2:]
    if not re.fullmatch(r"/?[A-Za-z0-9_./-]+", base):
        raise ValueError("SFTP_REMOTE_DIR must be an absolute or ~/ path without spaces")
    if not env["SFTP_REMOTE_DIR"].startswith(("/", "~/")) or ".." in base.split("/"):
        raise ValueError("SFTP_REMOTE_DIR must not traverse parent directories")
    app = env["APP_PATH"]
    if not re.fullmatch(r"/[A-Za-z0-9_-]+", app):
        raise ValueError("APP_PATH must be a single app subdirectory, e.g. /astro-forecast")
    if PurePosixPath(base).name == app.lstrip("/"):
        raise ValueError("SFTP_REMOTE_DIR must be the website directory, without APP_PATH")
    remote = base + app
    site = env["SITE_URL"].rstrip("/")
    url = urlsplit(site)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError("SITE_URL must be an HTTPS website origin without path or credentials")
    public_url = site + app
    port = int(env.get("SFTP_PORT") or "22")
    if not 1 <= port <= 65535:
        raise ValueError("SFTP_PORT is out of range")
    revision = env.get("DEPLOY_SHA") or env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("GITHUB_SHA must be the checked-out commit SHA")
    return host, user, remote, port, revision, public_url

def batch_commands(remote, revision):
    # Stage every upload before replacing any live file. Config files are excluded.
    commands = [f'cd "{remote}"']
    for path in FILES:
        commands.append(f'put "{path}" "{path}.deploy-{revision}"')
    for path in FILES:
        commands.append(f'rename "{path}.deploy-{revision}" "{path}"')
    return "\n".join(commands) + "\n"

def verify_public_files(revision, public_url):
    for path in ("index.html", "app.js", "sw.js"):
        request = Request(f"{public_url}/{path}?deploy={revision}", headers={"Cache-Control": "no-cache"})
        with urlopen(request, timeout=30) as response:
            body = response.read()
        expected = (ROOT / path).read_bytes()
        if hashlib.sha256(body).digest() != hashlib.sha256(expected).digest():
            raise RuntimeError(f"Public verification failed for {path}")
    print("Public index.html, app.js and sw.js match the deployed commit.")

def validate_private_key(private_key, child_env):
    # Decode locally before connecting; never print key material or passphrases.
    result = subprocess.run(
        ["ssh-keygen", "-y", "-f", str(private_key)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        env=child_env, timeout=30, check=False,
    )
    if result.returncode:
        raise ValueError("Cannot unlock SFTP_PRIVATE_KEY. Check the complete private key and SFTP_KEY_PASSPHRASE.")
    print("Private key successfully unlocked.", flush=True)


def sftp_command(batch, private_key, port, known_hosts, user, host, encrypted):
    # OpenSSH uses the first value. -b adds BatchMode=yes, so our override MUST precede it.
    return [
        "sftp", "-oBatchMode=" + ("no" if encrypted else "yes"),
        "-b", str(batch), "-i", str(private_key), "-P", str(port),
        "-oIdentitiesOnly=yes", "-oIdentityAgent=none",
        "-oPreferredAuthentications=publickey",
        "-oPasswordAuthentication=no", "-oKbdInteractiveAuthentication=no",
        "-oStrictHostKeyChecking=yes",
        "-oUserKnownHostsFile=" + str(known_hosts),
        "-oConnectTimeout=15", user + "@" + host,
    ]


def main():
    host, user, remote, port, revision, public_url = configuration(os.environ)
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
        validate_private_key(private_key, child_env)
        subprocess.run(sftp_command(batch, private_key, port, known_hosts, user, host, bool(passphrase)),
                       cwd=ROOT, env=child_env, check=True, timeout=300)
    verify_public_files(revision, public_url)

if __name__ == "__main__":
    main()
