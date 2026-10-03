from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from core.models import Permission, Role, UserRole


class PrivilegedRecoveryTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.manager = User.objects.create_user(username="user-manager")
        self.target = User.objects.create_user(username="instance-manager")
        self.admin = User.objects.create_user(username="recovery-admin", is_staff=True)
        self.role = Role.objects.create(name="Instance manager")
        self.instance_permission, _ = Permission.objects.get_or_create(code="settings.instance.manage")
        self.role.permissions.add(self.instance_permission)
        UserRole.objects.create(user=self.target, role=self.role)
        management = Role.objects.create(name="User and role manager")
        for code in ("settings.access.users.manage", "settings.access.roles.manage", "settings.access.roles.delete"):
            permission, _ = Permission.objects.get_or_create(code=code)
            management.permissions.add(permission)
        UserRole.objects.create(user=self.manager, role=management)
        self.client.force_authenticate(self.manager)

    def test_nonstaff_instance_manager_is_protected_from_password_takeover(self):
        for endpoint in ("reset-password", "password-reset-link"):
            response = self.client.post(f"/api/settings/users/{self.target.pk}/{endpoint}/", {"password": "Replacement-8472!"}, format="json")
            self.assertEqual(response.status_code, 403, response.data)

    def test_cannot_remove_protected_role_to_bypass_recovery_guard(self):
        response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"role_ids": []}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.patch(f"/api/settings/roles/{self.role.pk}/", {"permission_ids": []}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(f"/api/settings/roles/{self.role.pk}/").status_code, 403)

    def test_cannot_grant_instance_management_to_bypass_guard(self):
        response = self.client.post("/api/settings/roles/", {"name": "Escalation", "permission_ids": [self.instance_permission.pk]}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        response = self.client.patch(f"/api/settings/users/{self.manager.pk}/", {"role_ids": [self.role.pk]}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_disabled_privileged_account_remains_protected(self):
        self.target.is_active = False
        self.target.save()
        response = self.client.post(f"/api/settings/users/{self.target.pk}/reset-password/", {"password": "Replacement-Password-8472!"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_admin_and_delegated_instance_manager_can_reset(self):
        for actor in (self.admin, self.target):
            self.client.force_authenticate(actor)
            if actor == self.target:
                role = self.target.user_roles.first().role
                permission, _ = Permission.objects.get_or_create(code="settings.access.users.manage")
                role.permissions.add(permission)
            response = self.client.post(f"/api/settings/users/{self.target.pk}/reset-password/", {"password": "Replacement-Password-8472!"}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
