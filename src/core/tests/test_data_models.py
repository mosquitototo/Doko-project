from django.test import TestCase, TransactionTestCase
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from io import StringIO

from core.models import Alert, Case, Classification, Severity
from core.serializers import AlertSerializer, CaseSerializer, ClassificationSerializer, SeveritySerializer


class DataModelTests(TestCase):
    def test_custom_severity_can_be_assigned_to_cases_and_alerts(self):
        for code in ("Olala", "s" * 50, "low", "medium", "high", "critical"):
            Severity.objects.create(code=code, label=code)
            for model, serializer_class in ((Case, CaseSerializer), (Alert, AlertSerializer)):
                item = model.objects.create(title="Severity assignment")
                serializer = serializer_class(item, data={"severity": code}, partial=True)
                self.assertTrue(serializer.is_valid(), serializer.errors)
                serializer.save()
                item.refresh_from_db()
                self.assertEqual(item.severity, code)

    def test_assignment_rejects_unknown_inactive_and_overlong_severities(self):
        Severity.objects.create(code="disabled", label="Disabled", is_active=False)
        for serializer_class in (CaseSerializer, AlertSerializer):
            for code in ("unknown", "disabled", "s" * 51):
                serializer = serializer_class(data={"severity": code}, partial=True)
                self.assertFalse(serializer.is_valid())
                self.assertIn("severity", serializer.errors)

    def test_seed_keeps_standard_colors_and_preserves_customized_colors(self):
        call_command("seed_data_models", stdout=StringIO())
        expected = {"low": "cyan", "medium": "amber", "high": "orange", "critical": "red"}
        self.assertEqual(dict(Severity.objects.filter(code__in=expected).values_list("code", "color")), expected)
        Severity.objects.filter(code="high").update(color="violet")
        call_command("seed_data_models", stdout=StringIO())
        self.assertEqual(Severity.objects.get(code="high").color, "violet")

    def test_classification_120_character_code_can_be_created_and_assigned(self):
        code = "c" * 120
        serializer = ClassificationSerializer(data={"code": code, "label": "l" * 120})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        item = serializer.save()
        self.assertEqual(item.code, code)
        for cls in (AlertSerializer, CaseSerializer):
            self.assertEqual(cls().fields["classification"].run_validation(code), code)
            self.assertEqual(cls().validate_classification(code), code)
        for field in ("code", "label"):
            data = {"code": "unique", "label": "Label", field: "x" * 121}
            invalid = ClassificationSerializer(data=data)
            self.assertFalse(invalid.is_valid())
            self.assertEqual(invalid.errors[field][0].code, "max_length")

    def test_severity_limits_apply_to_create_and_update_without_truncating_input(self):
        serializer = SeveritySerializer(data={"code": "s" * 50, "label": "l" * 50})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        item = serializer.save()
        for field in ("code", "label"):
            for instance in (None, item):
                invalid = SeveritySerializer(instance, data={"code": "unique", "label": "Label", field: "x" * 51}, partial=True)
                self.assertFalse(invalid.is_valid())
                self.assertEqual(invalid.errors[field][0].code, "max_length")

    def test_duplicate_codes_are_rejected_including_inactive_records(self):
        for model, cls in ((Severity, SeveritySerializer), (Classification, ClassificationSerializer)):
            original = model.objects.create(code="duplicate", label="Original", is_active=False)
            serializer = cls(data={"code": original.code, "label": "Other label"})
            self.assertFalse(serializer.is_valid())
            self.assertEqual(serializer.errors["code"][0].code, "unique")

    def test_severity_color_defaults_to_gray_and_accepts_shared_palette_colors(self):
        first = SeveritySerializer(data={"code": "custom", "label": "Custom"})
        self.assertTrue(first.is_valid(), first.errors)
        self.assertEqual(first.save().color, "gray")
        for code in ("first", "second"):
            serializer = SeveritySerializer(data={"code": code, "label": code, "color": "violet"})
            self.assertTrue(serializer.is_valid(), serializer.errors)
            self.assertEqual(serializer.save().color, "violet")
        invalid = SeveritySerializer(data={"code": "invalid", "label": "Invalid", "color": "arbitrary-css"})
        self.assertFalse(invalid.is_valid())
        self.assertIn("color", invalid.errors)


class DataModelMigrationTests(TransactionTestCase):
    def test_upgrade_truncates_only_labels_and_keeps_standard_colors(self):
        old_target = [("core", "0046_instancesplunkhecsettings_verify_ssl")]
        new_target = [("core", "0047_data_model_limits_and_severity_color")]
        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        try:
            apps = executor.loader.project_state(old_target).apps
            old_severity = apps.get_model("core", "Severity")
            for code in ("low", "medium", "high", "critical", "custom"):
                old_severity.objects.create(code=code, label="é" * 100, order=3, is_active=False)
            executor = MigrationExecutor(connection)
            executor.migrate(new_target)
            severity = executor.loader.project_state(new_target).apps.get_model("core", "Severity")
            self.assertEqual(severity.objects.count(), 5)
            expected = {"low": "cyan", "medium": "amber", "high": "orange", "critical": "red", "custom": "gray"}
            for item in severity.objects.all():
                self.assertEqual(item.label, "é" * 50)
                self.assertEqual(item.color, expected[item.code])
                self.assertEqual(item.order, 3)
                self.assertFalse(item.is_active)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
