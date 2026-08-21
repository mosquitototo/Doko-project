from django.contrib import admin
from .models import Case, TimelineItem, ActionRun


@admin.register(Case)
class CaseAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "owner", "created_at", "updated_at")
    list_filter = ("status", "created_at")
    search_fields = ("title", "description")
    raw_id_fields = ("owner",)


@admin.register(TimelineItem)
class TimelineItemAdmin(admin.ModelAdmin):
    list_display = ("case", "date", "type", "created_at")
    list_filter = ("type", "date")
    search_fields = ("text",)
    raw_id_fields = ("case",)


@admin.register(ActionRun)
class ActionRunAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "connector_instance",
        "connector_endpoint",
        "scope",
        "status",
        "http_status",
        "requested_by",
        "created_at",
    )
    list_filter = (
        "status",
        "scope",
        "connector_instance",
        "connector_endpoint",
        "created_at",
    )
    search_fields = (
        "id",
        "target_id",
        "result_message",
        "requested_by__username",
        "connector_instance__name",
        "connector_endpoint__name",
    )
    readonly_fields = (
        "id",
        "created_at",
    )
