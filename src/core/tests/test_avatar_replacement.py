from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import override_settings
from rest_framework.test import APITestCase

from core.models import UserProfile


class AvatarReplacementTests(APITestCase):
    def setUp(self):
        media = TemporaryDirectory(prefix="doko-avatar-test-")
        self.addCleanup(media.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = get_user_model().objects.create_user(username="avatar-replacement")
        self.client.force_authenticate(self.user)
        self.profile = self.user.profile
        self.profile.avatar.save("old.png", self.upload(), save=True)
        self.old_name = self.profile.avatar.name
        self.storage = self.profile.avatar.storage

    def upload(self, name="new.png"):
        data = BytesIO()
        Image.new("RGB", (2, 2), "blue").save(data, format="PNG")
        return SimpleUploadedFile(name, data.getvalue(), content_type="image/png")

    def test_replacement_deletes_only_old_avatar_after_commit(self):
        other = get_user_model().objects.create_user(username="other-avatar")
        other.profile.avatar.save("other.png", self.upload(), save=True)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(self.storage.exists(self.old_name))
        self.profile.refresh_from_db()
        self.assertFalse(self.storage.exists(self.old_name))
        self.assertTrue(self.storage.exists(self.profile.avatar.name))
        self.assertTrue(self.storage.exists(other.profile.avatar.name))
        self.assertTrue(response.data["avatar_url"].endswith(self.profile.avatar.url))

    def test_invalid_upload_preserves_old_avatar(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/me/avatar/", {"avatar": SimpleUploadedFile("bad.png", b"invalid", content_type="image/png")}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.avatar.name, self.old_name)
        self.assertTrue(self.storage.exists(self.old_name))

    def test_rollback_preserves_old_avatar(self):
        with self.captureOnCommitCallbacks(execute=True):
            with transaction.atomic():
                response = self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
                self.assertEqual(response.status_code, 200)
                transaction.set_rollback(True)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.avatar.name, self.old_name)
        self.assertTrue(self.storage.exists(self.old_name))

    def test_shared_avatar_is_not_deleted(self):
        other = get_user_model().objects.create_user(username="shared-avatar")
        UserProfile.objects.filter(user=other).update(avatar=self.old_name)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.storage.exists(self.old_name))

    def test_same_upload_filename_keeps_new_image_and_removes_old_one(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/me/avatar/", {"avatar": self.upload("old.png")}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertNotEqual(self.profile.avatar.name, self.old_name)
        self.assertTrue(self.storage.exists(self.profile.avatar.name))
        self.assertFalse(self.storage.exists(self.old_name))

    def test_failed_save_preserves_old_avatar(self):
        with self.captureOnCommitCallbacks(execute=True):
            with patch.object(UserProfile, "save", side_effect=RuntimeError("Save failed")):
                with self.assertRaises(RuntimeError):
                    self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.avatar.name, self.old_name)
        self.assertTrue(self.storage.exists(self.old_name))

    def test_cleanup_failure_does_not_break_new_avatar(self):
        with patch.object(self.storage, "delete", side_effect=OSError("Storage unavailable")):
            with self.assertLogs(level="ERROR"):
                with self.captureOnCommitCallbacks(execute=True):
                    response = self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertTrue(self.storage.exists(self.profile.avatar.name))
        self.assertNotEqual(self.profile.avatar.name, self.old_name)

    def test_first_avatar_upload_still_works(self):
        user = get_user_model().objects.create_user(username="first-avatar")
        self.client.force_authenticate(user)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/me/avatar/", {"avatar": self.upload()}, format="multipart")
        self.assertEqual(response.status_code, 200)
        profile = UserProfile.objects.get(user=user)
        self.assertTrue(self.storage.exists(profile.avatar.name))
        self.assertTrue(response.data["avatar_url"].endswith(profile.avatar.url))
        self.assertTrue(self.storage.exists(self.old_name))
