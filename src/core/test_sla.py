from datetime import date, datetime, timedelta

from django.test import SimpleTestCase
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APITestCase
from io import StringIO
from unittest.mock import patch

from core.models import Alert, Case, Customer, CustomerAccess, Hunt, Permission, Role, UserRole
from core.serializers import compute_sla_info


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def calendar(**changes):
    return {
        "enabled": True,
        "timezone": "Europe/Paris",
        "weekdays": [0, 1, 2, 3, 4],
        "work_start": "09:00",
        "work_end": "16:00",
        "month_days": 20,
        "holidays": [],
        **changes,
    }


class WorkingCalendarTests(SimpleTestCase):
    def due(self, start, value=1, unit="hour", **changes):
        from core.sla import calculate_deadline

        return calculate_deadline(instant(start), {"value": value, "unit": unit}, calendar(**changes))

    def test_day_is_one_shift_not_twenty_four_hours(self):
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="day"), instant("2026-09-07T14:00:00Z"))

    def test_partial_shift_continues_after_weekend(self):
        self.assertEqual(self.due("2026-09-11T13:00:00Z", 2), instant("2026-09-14T08:00:00Z"))

    def test_after_end_and_before_start_wait_for_opening(self):
        for start in ("2026-09-11T14:00:00Z", "2026-09-13T12:00:00Z", "2026-09-14T06:00:00Z"):
            with self.subTest(start=start):
                self.assertEqual(self.due(start), instant("2026-09-14T08:00:00Z"))

    def test_week_tracks_selected_days(self):
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="week"), instant("2026-09-11T14:00:00Z"))
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="week", weekdays=list(range(6))), instant("2026-09-12T14:00:00Z"))
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="week", weekdays=list(range(7))), instant("2026-09-13T14:00:00Z"))

    def test_month_contract_is_configurable(self):
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="month"), instant("2026-10-02T14:00:00Z"))
        self.assertEqual(self.due("2026-09-07T07:00:00Z", unit="month", month_days=6, weekdays=list(range(6))), instant("2026-09-12T14:00:00Z"))

    def test_manual_holidays_and_annual_recurrence(self):
        self.assertEqual(self.due("2026-07-13T13:00:00Z", 2, holidays=[{"date": "2025-07-14", "annual": True, "label": "Holiday"}]), instant("2026-07-15T08:00:00Z"))
        self.assertEqual(self.due("2026-09-11T13:00:00Z", 2, holidays=[{"date": "2026-09-14"}]), instant("2026-09-15T08:00:00Z"))
        self.assertEqual(self.due("2026-07-13T13:00:00Z", 2, holidays=[{"date": "2025-07-14"}]), instant("2026-07-14T08:00:00Z"))

    def test_timezone_dst_transition_and_foreign_customer(self):
        self.assertEqual(self.due("2026-03-27T14:00:00Z", 2), instant("2026-03-30T08:00:00Z"))
        self.assertEqual(self.due("2026-09-07T00:00:00Z", timezone="Asia/Tokyo"), instant("2026-09-07T01:00:00Z"))

    def test_twenty_four_hour_coverage_and_elapsed_compatibility(self):
        self.assertEqual(self.due("2026-09-13T22:00:00Z", 3, work_start="00:00", work_end="24:00", weekdays=list(range(7))), instant("2026-09-14T01:00:00Z"))
        self.assertEqual(self.due("2026-09-11T13:00:00Z", 1, "day", enabled=False), instant("2026-09-12T13:00:00Z"))

    def test_working_time_and_arrival_boundaries(self):
        from core.sla import working_seconds, is_working_time

        self.assertEqual(working_seconds(instant("2026-09-11T13:00:00Z"), instant("2026-09-14T08:00:00Z"), calendar()), 7200)
        self.assertTrue(is_working_time(instant("2026-09-07T07:00:00Z"), calendar()))
        self.assertFalse(is_working_time(instant("2026-09-07T14:00:00Z"), calendar()))
        self.assertFalse(is_working_time(instant("2026-09-07T08:00:00Z"), calendar(holidays=[{"date": "2026-09-07"}])))

    def test_invalid_calendars_are_rejected(self):
        from core.sla import validate_calendar

        for change in ({"timezone": "bad"}, {"weekdays": []}, {"weekdays": [7]}, {"weekdays": [True]}, {"work_end": "08:00"}, {"work_start": "25:00"}, {"month_days": 0}, {"month_days": 1.5}, {"holidays": ["not-a-date"]}, {"holidays": [{"date": "2026-02-30"}]}, {"holidays": [{"date": "2026-01-01", "annual": "false"}]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_calendar(calendar(**change))

    def test_dst_shift_uses_real_elapsed_hours_and_leap_holiday(self):
        self.assertEqual(self.due("2026-03-29T00:00:00Z", 3, weekdays=list(range(7)), work_start="01:00", work_end="05:00"), instant("2026-03-29T03:00:00Z"))
        self.assertEqual(self.due("2026-10-24T23:00:00Z", 5, weekdays=list(range(7)), work_start="01:00", work_end="05:00"), instant("2026-10-25T04:00:00Z"))
        self.assertEqual(self.due("2028-02-28T14:00:00Z", 2, holidays=[{"date": "2024-02-29", "annual": True}]), instant("2028-03-01T09:00:00Z"))

    def test_nonexistent_end_time_moves_forward_across_dst_gap(self):
        self.assertEqual(self.due("2026-03-29T00:00:00Z", 90, "minute", weekdays=list(range(7)), work_start="01:00", work_end="02:30"), instant("2026-03-29T01:30:00Z"))

    def test_calendar_cannot_exclude_every_day_of_every_year(self):
        from core.sla import validate_calendar

        holidays = [{"date": (date(2024, 1, 1) + timedelta(days=day)).isoformat(), "annual": True} for day in range(366)]
        with self.assertRaises(ValueError):
            validate_calendar(calendar(holidays=holidays))


class CustomerSlaTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username="sla-admin", is_staff=True)
        self.client.force_authenticate(self.admin)
        self.customer = Customer.objects.create(name="SLA customer", sla_rules={"medium": {"value": 2, "unit": "hour"}})

    def configure(self, **changes):
        response = self.client.patch(f"/api/settings/customers/{self.customer.id}/", {"sla_calendar": calendar(**changes)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data.get("sla_calendar"), calendar(**changes))
        self.customer.refresh_from_db()

    def alert(self, created="2026-09-11T13:00:00Z", **fields):
        with patch("django.utils.timezone.now", return_value=instant(created)):
            return Alert.objects.create(title="SLA fixture", customer=self.customer, **fields)

    def info(self, alert):
        return compute_sla_info(alert, {"closed", "merged"})

    def test_customer_settings_validate_calendar_and_preserve_relations(self):
        case = Case.objects.create(title="Case", customer=self.customer)
        hunt = Hunt.objects.create(title="Hunt", customer=self.customer)
        alert = self.alert()
        self.configure()
        for obj in (case, hunt, alert):
            obj.refresh_from_db()
            self.assertEqual(obj.customer_id, self.customer.id)
        response = self.client.patch(f"/api/settings/customers/{self.customer.id}/", {"sla_calendar": calendar(weekdays=[])}, format="json")
        self.assertEqual(response.status_code, 400)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.sla_calendar["weekdays"], [0, 1, 2, 3, 4])

    def test_deadline_and_rule_stay_frozen_after_customer_settings_change(self):
        self.configure()
        alert = self.alert()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-14T08:00:00Z"))
        self.configure(work_end="18:00")
        self.customer.sla_rules = {"medium": {"value": 8, "unit": "hour"}}
        self.customer.save()
        alert.refresh_from_db()
        alert.title = "Updated title"
        alert.save()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-14T08:00:00Z"))
        self.assertEqual(self.info(alert)["sla_rule"], {"value": 2, "unit": "hour"})
        newer = self.alert()
        self.assertEqual(self.info(newer)["sla_due_at"], instant("2026-09-14T12:00:00Z"))

    def test_customer_and_severity_reassignment_still_apply_the_correct_rule(self):
        self.configure()
        alert = self.alert()
        other = Customer.objects.create(name="Other", sla_rules={"high": {"value": 1, "unit": "hour"}})
        alert.customer = other
        alert.severity = "high"
        alert.save()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-11T14:00:00Z"))

    def test_acknowledgement_and_dashboard_use_the_same_deadline(self):
        self.configure()
        alert = self.alert(status="closed", sla_acknowledged_at=instant("2026-09-14T07:30:00Z"))
        self.assertEqual(self.info(alert)["sla_state"], "completed")
        response = self.dashboard()
        self.assertEqual(response.data["sla"]["global"]["within_sla_count"], 1)
        self.assertEqual(response.data["sla"]["global"]["avg_resolution_hours"], 1.5)
        alert.sla_acknowledged_at = instant("2026-09-14T08:01:00Z")
        alert.save()
        self.assertEqual(self.info(alert)["sla_state"], "overdue_completed")
        self.assertEqual(self.dashboard().data["sla"]["global"]["breached_count"], 1)

    def dashboard(self, **params):
        return self.client.get("/api/dashboard/", {"period": "between", "date_from": "2026-09-01", "date_to": "2026-09-30", **params})

    def test_out_of_hours_respects_customer_period_deletion_and_permissions(self):
        self.configure()
        self.alert("2026-09-07T07:00:00Z")
        self.alert("2026-09-07T14:00:00Z")
        self.alert("2026-09-06T10:00:00Z")
        self.alert("2026-08-30T10:00:00Z")
        self.alert("2026-09-06T10:00:00Z", is_deleted=True)
        other = Customer.objects.create(name="Other", sla_calendar=calendar())
        with patch("django.utils.timezone.now", return_value=instant("2026-09-06T10:00:00Z")):
            Alert.objects.create(title="Other alert", customer=other)
        self.assertEqual(self.dashboard().data["kpis"]["alerts_out_of_hours"]["count"], 3)
        self.assertEqual(self.dashboard(customer=str(self.customer.id)).data["kpis"]["alerts_out_of_hours"]["count"], 2)
        user = get_user_model().objects.create_user(username="scoped-sla")
        permission, _ = Permission.objects.get_or_create(code="alert.view")
        role = Role.objects.create(name="SLA reader")
        role.permissions.add(permission)
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(user=user, customer=self.customer)
        self.client.force_authenticate(user)
        self.assertEqual(self.dashboard().data["kpis"]["alerts_out_of_hours"]["count"], 2)
        self.assertEqual(self.dashboard(customer=str(other.id)).status_code, 403)
        self.assertEqual(self.client.patch(f"/api/settings/customers/{self.customer.id}/", {"sla_calendar": calendar()}, format="json").status_code, 403)
        role.permissions.clear()
        self.assertEqual(self.dashboard().data["kpis"]["alerts_out_of_hours"]["count"], 0)

    def test_explicit_recalculation_changes_only_sla_snapshot(self):
        alert = self.alert()
        original_updated_at = alert.updated_at
        self.configure()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-11T15:00:00Z"))
        call_command("recalculate_sla", customer=str(self.customer.id), stdout=StringIO())
        alert.refresh_from_db()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-11T15:00:00Z"))
        call_command("recalculate_sla", customer=str(self.customer.id), apply=True, stdout=StringIO())
        alert.refresh_from_db()
        self.assertEqual(self.info(alert)["sla_due_at"], instant("2026-09-14T08:00:00Z"))
        self.assertEqual(alert.updated_at, original_updated_at)
        self.assertEqual(alert.title, "SLA fixture")
        self.assertEqual(alert.customer_id, self.customer.id)

    def test_dashboard_does_not_mix_different_frozen_sla_budgets(self):
        self.configure()
        self.alert(status="closed", sla_acknowledged_at=instant("2026-09-14T07:30:00Z"))
        self.customer.sla_rules = {"medium": {"value": 4, "unit": "hour"}}
        self.customer.save()
        self.alert(status="closed", sla_acknowledged_at=instant("2026-09-14T08:30:00Z"))
        rows = self.dashboard().data["sla"]["by_customer"]
        self.assertEqual(sorted(row["sla_hours"] for row in rows), [2, 4])
        self.assertEqual(sum(row["within_sla_count"] for row in rows), 2)

    def test_widget_reports_missing_calendars_instead_of_assuming_working_hours(self):
        self.alert()
        result = self.dashboard().data["kpis"]["alerts_out_of_hours"]
        self.assertEqual(result, {"count": 0, "evaluated": 0, "unconfigured": 1})

    def test_holidays_and_timezone_are_customer_specific_in_widget(self):
        self.configure(holidays=[{"date": "2025-09-07", "annual": True, "label": "Holiday"}])
        self.alert("2026-09-07T08:00:00Z")
        other = Customer.objects.create(name="Tokyo", sla_calendar=calendar(timezone="Asia/Tokyo"))
        with patch("django.utils.timezone.now", return_value=instant("2026-09-07T00:00:00Z")):
            Alert.objects.create(title="Tokyo open", customer=other)
        self.assertEqual(self.dashboard(customer=str(self.customer.id)).data["kpis"]["alerts_out_of_hours"], {"count": 1, "evaluated": 1, "unconfigured": 0})
        self.assertEqual(self.dashboard(customer=str(other.id)).data["kpis"]["alerts_out_of_hours"], {"count": 0, "evaluated": 1, "unconfigured": 0})
