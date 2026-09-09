from uuid import uuid4

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import Alert, Case, Customer, CustomerAccess, CustomerSubgroup, Permission, Role, UserRole


class CustomerSubgroupTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username="subgroup-admin", is_staff=True)
        self.client.force_authenticate(self.admin)
        self.customer = Customer.objects.create(name="Subgroup customer")
        self.other = Customer.objects.create(name="Other subgroup customer")
        self.group = CustomerSubgroup.objects.create(customer=self.customer, name="Unit A")
        self.group2 = CustomerSubgroup.objects.create(customer=self.customer, name="Unit B")
        self.foreign = CustomerSubgroup.objects.create(customer=self.other, name="Other unit")
        self.alert = Alert.objects.create(customer=self.customer, title="Subgroup alert")
        self.case = Case.objects.create(customer=self.customer, title="Subgroup case")

    def test_customer_nested_crud_preserves_omitted_groups_and_sla(self):
        url = f"/api/settings/customers/{self.customer.pk}/"
        response = self.client.patch(url, {"subgroups": [{"id": str(self.group.pk), "name": "Renamed", "description": "Scope", "contacts": [{"name": "Contact", "email": "contact@example.org"}]}]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(str(response.data["subgroups"][0]["id"]), str(self.group.pk))
        self.assertEqual(response.data["subgroups"][0]["contacts"][0]["email"], "contact@example.org")
        self.assertFalse(CustomerSubgroup.objects.filter(pk=self.group2.pk).exists())
        calendar = response.data["sla_calendar"]
        response = self.client.patch(url, {"sla": "Contract"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["subgroups"]), 1)
        self.assertEqual(response.data["sla_calendar"], calendar)
        response = self.client.post("/api/settings/customers/", {"name": "Created with groups", "subgroups": [{"name": "New unit", "contacts": []}]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["subgroups"][0]["id"])

    def test_invalid_nested_data_is_atomic(self):
        url = f"/api/settings/customers/{self.customer.pk}/"
        for groups in (
            [{"id": str(self.foreign.pk), "name": "Forbidden"}],
            [{"name": "Unit"}, {"name": "unit"}],
            [{"name": "Bad contact", "contacts": [{"name": "Contact", "email": "invalid"}]}],
            [{"id": str(self.group.pk), "name": "One"}, {"id": str(self.group.pk), "name": "Two"}],
            [{"id": str(self.group.pk), "description": "Missing name"}],
            [{"description": "Missing name"}],
            [{"name": "Missing contact name", "contacts": [{"email": "contact@example.org"}]}],
        ):
            response = self.client.patch(url, {"name": "Must not save", "subgroups": groups}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.name, "Subgroup customer")
        self.assertEqual(self.customer.subgroups.count(), 2)

    def test_create_and_update_alerts_cases_with_optional_group_uuids(self):
        for collection in ("alerts", "cases"):
            url = f"/api/{collection}/"
            for extra in ({}, {"subgroups": [str(self.group.pk), str(self.group2.pk)]}):
                response = self.client.post(url, {"title": "API subgroup test", "customer": str(self.customer.pk), **extra}, format="json")
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(set(map(str, response.data["subgroups"])), set(extra.get("subgroups", [])))
            detail = f"{url}{response.data['id']}/"
            response = self.client.patch(detail, {"title": "Preserve assignment"}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(len(response.data["subgroups"]), 2)
            response = self.client.patch(detail, {"subgroups": []}, format="json")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["subgroups"], [])

    def test_invalid_assignment_cannot_change_other_fields(self):
        for collection, obj in (("alerts", self.alert), ("cases", self.case)):
            for groups in ([str(self.foreign.pk)], [str(uuid4())], ["bad"], None):
                response = self.client.patch(f"/api/{collection}/{obj.pk}/", {"title": "Must not save", "subgroups": groups}, format="json")
                self.assertEqual(response.status_code, 400, response.data)
            obj.refresh_from_db()
            self.assertNotEqual(obj.title, "Must not save")

    def test_customer_change_clears_groups_but_not_same_customer_or_empty_selection(self):
        for collection, obj in (("alerts", self.alert), ("cases", self.case)):
            obj.subgroups.add(self.group)
            url = f"/api/{collection}/{obj.pk}/"
            response = self.client.patch(url, {"customer": str(self.customer.pk)}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(obj.subgroups.count(), 1)
            response = self.client.patch(url, {"customer": str(self.other.pk)}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertFalse(obj.subgroups.exists())
            response = self.client.patch(url, {"customer": str(self.customer.pk), "subgroups": [str(self.group.pk)]}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            response = self.client.patch(url, {"customer": None}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertFalse(obj.subgroups.exists())

    def test_group_deletion_keeps_alert_case_customer_and_contacts(self):
        self.alert.subgroups.add(self.group, self.group2)
        self.case.subgroups.add(self.group)
        self.group.delete()
        self.alert.refresh_from_db()
        self.case.refresh_from_db()
        self.assertEqual(self.alert.customer_id, self.customer.pk)
        self.assertEqual(self.case.customer_id, self.customer.pk)
        self.assertEqual(list(self.alert.subgroups.all()), [self.group2])
        self.assertEqual(self.case.subgroups.count(), 0)

    def test_dashboard_is_explicit_or_and_has_no_double_counting(self):
        self.alert.subgroups.add(self.group, self.group2)
        self.case.subgroups.add(self.group, self.group2)
        Alert.objects.create(customer=self.customer, title="Customer only")
        Case.objects.create(customer=self.customer, title="Customer only")
        empty = CustomerSubgroup.objects.create(customer=self.customer, name="Empty")
        url = "/api/dashboard/"
        base = {"customer": str(self.customer.pk), "period": "all"}
        for ids, expected in (([], 2), ([str(self.group.pk)], 1), ([str(self.group.pk), str(self.group2.pk)], 1), ([str(empty.pk)], 0)):
            response = self.client.get(url, {**base, "subgroups": ids})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["kpis"]["alerts_open"], expected)
            self.assertEqual(response.data["kpis"]["cases_open"], expected)
            self.assertEqual(sum(row["value"] for row in response.data["charts"]["open_alerts_by_customer"]), expected)
        for params in ({"subgroups": [str(self.group.pk)]}, {**base, "subgroups": [str(self.foreign.pk)]}, {**base, "subgroups": ["bad"]}):
            self.assertEqual(self.client.get(url, params).status_code, 400)

    def test_customer_permissions_apply_to_subgroup_assignments_and_statistics(self):
        user = get_user_model().objects.create_user(username="subgroup-scoped")
        role = Role.objects.create(name="Subgroup role")
        for code in ("alert.view", "alert.update", "case.view", "case.update"):
            permission, _ = Permission.objects.get_or_create(code=code)
            role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(customer=self.customer, role=role)
        other_alert = Alert.objects.create(customer=self.other, title="Hidden")
        other_alert.subgroups.add(self.foreign)
        self.client.force_authenticate(user)
        scopes = self.client.get("/api/customers/scopes/")
        self.assertEqual(scopes.status_code, 200)
        self.assertEqual([row["id"] for row in scopes.data], [str(self.customer.pk)])
        self.assertEqual(set(scopes.data[0]["subgroups"][0]), {"id", "name"})
        self.assertNotIn("contacts", scopes.data[0])
        response = self.client.patch(f"/api/alerts/{self.alert.pk}/", {"subgroups": [str(self.group.pk)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(f"/api/alerts/{self.alert.pk}/", {"customer": str(self.other.pk), "subgroups": [str(self.foreign.pk)]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get(f"/api/alerts/{other_alert.pk}/").status_code, 403)
        self.assertEqual(self.client.get("/api/dashboard/", {"customer": str(self.other.pk), "subgroups": [str(self.foreign.pk)]}).status_code, 403)
        role.permissions.clear()
        self.assertEqual(self.client.patch(f"/api/alerts/{self.alert.pk}/", {"subgroups": []}, format="json").status_code, 403)

    def test_scope_directory_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/customers/scopes/").status_code, (401, 403))

    def test_dashboard_subgroup_pies_count_assignments_without_changing_totals(self):
        self.alert.subgroups.add(self.group, self.group2)
        self.case.subgroups.add(self.group, self.group2)
        for model in (Alert, Case):
            model.objects.create(customer=self.customer, title="Unassigned")
            foreign = model.objects.create(customer=self.other, title="Other customer")
            foreign.subgroups.add(self.foreign)
        empty = CustomerSubgroup.objects.create(customer=self.customer, name="Empty")
        for params, total, expected in (
            ({}, 3, {str(self.group.pk): 1, str(self.group2.pk): 1, str(self.foreign.pk): 1}),
            ({"customer": str(self.customer.pk)}, 2, {str(self.group.pk): 1, str(self.group2.pk): 1}),
            ({"customer": str(self.customer.pk), "subgroups": [str(self.group.pk)]}, 1, {str(self.group.pk): 1}),
            ({"customer": str(self.customer.pk), "subgroups": [str(self.group.pk), str(self.group2.pk)]}, 1, {str(self.group.pk): 1, str(self.group2.pk): 1}),
            ({"customer": str(self.customer.pk), "subgroups": [str(empty.pk)]}, 0, {}),
        ):
            response = self.client.get("/api/dashboard/", {"period": "all", **params})
            self.assertEqual(response.status_code, 200, response.data)
            for kind in ("alerts", "cases"):
                key = f"{kind}_by_subgroup_period"
                self.assertIn(key, response.data["charts"])
                rows = response.data["charts"][key]
                self.assertEqual({row["key"]: row["value"] for row in rows}, expected)
                self.assertEqual(response.data["kpis"][f"{kind}_open"], total)
                if not params:
                    self.assertIn(f"{self.customer.name} — {self.group.name}", [row["label"] for row in rows])

    def test_dashboard_subgroup_pies_respect_period_and_permissions(self):
        from datetime import timedelta
        from django.utils import timezone

        for model, current in ((Alert, self.alert), (Case, self.case)):
            current.subgroups.add(self.group)
            old = model.objects.create(customer=self.customer, title="Old")
            old.subgroups.add(self.group2)
            model.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=60))
            hidden = model.objects.create(customer=self.other, title="Hidden")
            hidden.subgroups.add(self.foreign)
        user = get_user_model().objects.create_user(username="dashboard-subgroups")
        role = Role.objects.create(name="Dashboard subgroups")
        for code in ("alert.view", "case.view"):
            permission, _ = Permission.objects.get_or_create(code=code)
            role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(customer=self.customer, role=role)
        self.client.force_authenticate(user)
        response = self.client.get("/api/dashboard/", {"period": "last_7d"})
        self.assertEqual(response.status_code, 200, response.data)
        for kind in ("alerts", "cases"):
            key = f"{kind}_by_subgroup_period"
            self.assertIn(key, response.data["charts"])
            self.assertEqual({row["key"]: row["value"] for row in response.data["charts"][key]}, {str(self.group.pk): 1})
        role.permissions.remove(Permission.objects.get(code="case.view"))
        response = self.client.get("/api/dashboard/", {"period": "last_7d"})
        self.assertEqual(response.data["charts"]["cases_by_subgroup_period"], [])
        self.assertEqual(len(response.data["charts"]["alerts_by_subgroup_period"]), 1)

    def test_dashboard_widget_upgrade_preserves_layout_and_is_idempotent(self):
        from importlib import import_module
        from django.apps import apps
        from django.db import connection
        from core.models import DashboardPreference

        preference = DashboardPreference.objects.create(user=self.admin, widgets=["sla_global", "cases_open"])
        upgrade = import_module("core.migrations.0045_dashboard_subgroup_widgets").add_subgroup_widgets
        with connection.schema_editor() as editor:
            upgrade(apps, editor)
            upgrade(apps, editor)
        preference.refresh_from_db()
        self.assertEqual(preference.widgets, ["sla_global", "cases_open", "alerts_by_subgroup_period", "cases_by_subgroup_period"])
        response = self.client.get("/api/dashboard/preferences/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["widgets"], preference.widgets)
