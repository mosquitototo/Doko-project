from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import Alert, Case, Customer, CustomerAccess, Permission, Role, UserRole


class ListAvatarTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username="avatar-admin", is_staff=True)
        self.owner = User.objects.create_user(username="avatar-owner")
        self.owner.profile.avatar = "avatars/list-test.png"
        self.owner.profile.save(update_fields=["avatar"])
        self.customer = Customer.objects.create(name="Avatar scope")
        self.client.force_authenticate(self.admin)

    def test_user_list_includes_avatar_or_null_and_preserves_search(self):
        response = self.client.get("/api/settings/users/", {"q": "avatar-"})
        self.assertEqual(response.status_code, 200)
        users = {row["username"]: row for row in response.data["results"]}
        self.assertIn("avatar_url", users["avatar-owner"])
        self.assertTrue(users["avatar-owner"]["avatar_url"].endswith("/avatars/list-test.png"))
        self.assertIsNone(users["avatar-admin"]["avatar_url"])
        filtered = self.client.get("/api/settings/users/", {"q": "avatar-owner"})
        self.assertEqual(filtered.data["count"], 1)
        self.assertEqual(filtered.data["results"][0]["id"], self.owner.pk)

    def test_owner_avatars_follow_record_permissions_not_user_management_permissions(self):
        viewer = get_user_model().objects.create_user(username="avatar-viewer")
        role = Role.objects.create(name="Avatar record viewer")
        for code in ("alert.view", "case.view"):
            permission, _ = Permission.objects.get_or_create(code=code)
            role.permissions.add(permission)
        UserRole.objects.create(user=viewer, role=role)
        CustomerAccess.objects.create(customer=self.customer, role=role)
        other = Customer.objects.create(name="Hidden avatar scope")
        self.client.force_authenticate(viewer)
        for model, collection in ((Alert, "alerts"), (Case, "cases")):
            assigned = model.objects.create(title="Assigned", customer=self.customer, owner=self.owner)
            unassigned = model.objects.create(title="Unassigned", customer=self.customer)
            no_avatar = model.objects.create(title="No avatar", customer=self.customer, owner=self.admin)
            model.objects.create(title="Hidden", customer=other, owner=self.owner)
            response = self.client.get(f"/api/{collection}/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["count"], 3)
            rows = {str(row["id"]): row for row in response.data["results"]}
            self.assertIn("owner_avatar_url", rows[str(assigned.pk)])
            self.assertTrue(rows[str(assigned.pk)]["owner_avatar_url"].endswith("/avatars/list-test.png"))
            self.assertIsNone(rows[str(unassigned.pk)]["owner_avatar_url"])
            self.assertIsNone(rows[str(no_avatar.pk)]["owner_avatar_url"])
            filtered = self.client.get(f"/api/{collection}/", {"owner": self.owner.pk, "ordering": "owner"})
            self.assertEqual(filtered.status_code, 200)
            self.assertEqual(filtered.data["count"], 1)
            self.assertEqual(str(filtered.data["results"][0]["id"]), str(assigned.pk))
        self.assertEqual(self.client.get("/api/settings/users/").status_code, 403)
