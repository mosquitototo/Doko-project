import os
from pathlib import Path
import subprocess
import unittest
import time


@unittest.skipUnless(os.environ.get("DOKO_TEST_NGINX_IMAGE"), "Requires an existing local Nginx image")
class NginxHeadersTests(unittest.TestCase):
    def test_spa_and_assets_have_security_headers(self):
        config = os.environ.get("DOKO_TEST_NGINX_CONFIG") or Path(__file__).resolve().parents[3] / "docker/nginx/nginx.conf"
        container = subprocess.check_output([
            "docker", "run", "--pull=never", "--rm", "-d", "--network", "none",
            "-v", f"{config}:/etc/nginx/nginx.conf:ro", os.environ["DOKO_TEST_NGINX_IMAGE"],
        ], text=True).strip()
        try:
            subprocess.run(["docker", "exec", container, "nginx", "-t"], check=True, capture_output=True)
            for attempt in range(50):
                ready = subprocess.run(["docker", "exec", container, "nc", "-z", "127.0.0.1", "80"], capture_output=True)
                if ready.returncode == 0:
                    break
                time.sleep(0.1)
            self.assertEqual(ready.returncode, 0)
            for path in ("/", "/login", "/cases", "/assets/missing.js", "/static/missing.css"):
                result = subprocess.run(["docker", "exec", "-i", container, "nc", "-w", "2", "127.0.0.1", "80"], input=f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", capture_output=True, text=True)
                headers = result.stdout.split("\n\n", 1)[0].lower()
                with self.subTest(path=path):
                    self.assertIn("x-frame-options: deny", headers)
                    self.assertIn("x-content-type-options: nosniff", headers)
                    self.assertIn("content-security-policy: frame-ancestors 'none'", headers)
                    self.assertIn("referrer-policy: same-origin", headers)
                    if path in ("/", "/login", "/cases"):
                        self.assertIn("cache-control: no-store", headers)
        finally:
            subprocess.run(["docker", "stop", container], check=True, capture_output=True)
