from django.contrib import admin
from .models import Event, TimelineItem, Addon, AddonAction, ActionRun


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "owner", "created_at", "updated_at")
    list_filter = ("status", "created_at")
    search_fields = ("title", "description")
    raw_id_fields = ("owner",)


@admin.register(TimelineItem)
class TimelineItemAdmin(admin.ModelAdmin):
    list_display = ("event", "date", "type", "created_at")
    list_filter = ("type", "date")
    search_fields = ("text",)
    raw_id_fields = ("event",)


@admin.register(Addon)
class AddonAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "version", "is_enabled", "installed_at")
    search_fields = ("id", "name")


@admin.register(AddonAction)
class AddonActionAdmin(admin.ModelAdmin):
    list_display = ("action_id", "label", "scope", "method", "path", "is_enabled", "addon")
    list_filter = ("scope", "is_enabled", "addon")


@admin.register(ActionRun)
class ActionRunAdmin(admin.ModelAdmin):
    list_display = ("id", "addon", "action", "scope", "target_id", "status", "http_status", "created_at", "requested_by")
    list_filter = ("status", "scope", "addon")
    search_fields = ("target_id",)