from pathlib import PurePosixPath
import mimetypes

from django.http import FileResponse, Http404
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import Attachment, ReportInstance, UserProfile
from .rbac import user_has_perm


class ProtectedMediaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, path):
        normalized = str(PurePosixPath(path or ""))
        if not normalized or normalized.startswith("/") or ".." in PurePosixPath(normalized).parts:
            raise Http404

        attachment = Attachment.objects.select_related("case").filter(file=normalized).first()
        if attachment:
            case = attachment.case
            if not user_has_perm(request.user, "case.view", customer_id=case.customer_id):
                raise Http404
            return self._response(attachment.file, attachment.original_name or PurePosixPath(normalized).name)

        report = ReportInstance.objects.select_related("case").filter(pdf=normalized).first()
        if report:
            if not user_has_perm(request.user, "case.view", customer_id=report.case.customer_id):
                raise Http404
            return self._response(report.pdf, f"case-report-{report.id}.pdf")

        profile = UserProfile.objects.filter(avatar=normalized, user__is_active=True).first()
        if profile:
            return self._response(profile.avatar, PurePosixPath(normalized).name, inline=True)

        raise Http404

    @staticmethod
    def _response(field_file, filename, inline=False):
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        response = FileResponse(field_file.open("rb"), content_type=content_type)
        disposition = "inline" if inline else "attachment"
        response["Content-Disposition"] = f'{disposition}; filename="{PurePosixPath(filename).name}"'
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response
