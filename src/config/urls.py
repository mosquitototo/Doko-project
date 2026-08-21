from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from core.views_media import ProtectedMediaView


def health(_request):
    return JsonResponse({"ok": True})


urlpatterns = [
    path("api/health/", health),
    path("media/<path:path>", ProtectedMediaView.as_view()),
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
