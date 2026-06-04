from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from django.utils import timezone

from .models import ChatGeneratedDraft, ChatRun, ChatSession, InvestigationTemplate
from .rbac import user_has_perm, get_accessible_customer_ids
from .serializers_chat import ChatRunSerializer, ChatSessionSerializer
from .services_chat import create_chat_run, execute_chat_run, generate_comment_draft, refresh_chat_run_actions
from .services_chat_posting import post_generated_draft, user_can_access_draft_target
from .celerytasks import execute_chat_run_task


def _forbidden():
    return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)


def _has_any_chat_run_perm(user):
    return (
        user_has_perm(user, "chat.use")
        or user_has_perm(user, "chat.llm.use")
        or user_has_perm(user, "chat.soar.use")
    )


class ChatSessionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not user_has_perm(request.user, "chat.use"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        qs = ChatSession.objects.filter(user=request.user, is_archived=False).order_by("-updated_at")[:50]
        return Response(ChatSessionSerializer(qs, many=True).data)

    def post(self, request):
        if not user_has_perm(request.user, "chat.use"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        client_tab_id = (request.data.get("client_tab_id") or "").strip()
        if not client_tab_id:
            return Response({"detail": "client_tab_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        customer_id = str(request.data.get("customer_id") or "").strip()
        if customer_id and not request.user.is_staff:
            allowed = set(str(x) for x in get_accessible_customer_ids(request.user))
            if customer_id not in allowed:
                return _forbidden()
            
        session = ChatSession.objects.create(
            user=request.user,
            title=(request.data.get("title") or "").strip(),
            surface=request.data.get("surface") or "dedicated",
            page_type=request.data.get("page_type") or "",
            object_id=request.data.get("object_id") or "",
            customer_id=customer_id,
            client_tab_id=client_tab_id,
        )
        return Response(ChatSessionSerializer(session).data, status=status.HTTP_201_CREATED)


class ChatSessionArchiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        if not user_has_perm(request.user, "chat.use"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        session = ChatSession.objects.filter(id=session_id, user=request.user, is_archived=False).first()
        if not session:
            return Response({"detail": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        session.is_archived = True
        session.save(update_fields=["is_archived", "updated_at"])
        return Response({"ok": True})
    

class ChatSessionClearView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        if not user_has_perm(request.user, "chat.use"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        session = ChatSession.objects.filter(id=session_id, user=request.user, is_archived=False).first()
        if not session:
            return Response({"detail": "Session not found"}, status=status.HTTP_404_NOT_FOUND)

        session.is_archived = True
        session.save(update_fields=["is_archived", "updated_at"])

        return Response({"ok": True}, status=status.HTTP_200_OK)
    

class ChatRunCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, session_id):
        if not user_has_perm(request.user, "chat.use"):
            return _forbidden()

        if not user_has_perm(request.user, "chat.llm.use"):
            return _forbidden()
        
        session = ChatSession.objects.filter(id=session_id, user=request.user).first()
        if not session:
            return Response({"detail": "Session not found"}, status=status.HTTP_404_NOT_FOUND)
        client_tab_id = (request.data.get("client_tab_id") or "").strip()
        request_id = (request.data.get("request_id") or "").strip()
        message = (request.data.get("message") or "").strip()
        if not client_tab_id or not request_id or not message:
            return Response(
                {"detail": "client_tab_id, request_id and message are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        template_code = str(request.data.get("template_code") or "").strip()
        chat_command = str(request.data.get("chat_command") or "").strip()
        is_command_run = message.startswith("/") or bool(template_code) or bool(chat_command)

        if is_command_run and not user_has_perm(request.user, "chat.soar.use"):
            return _forbidden()
        
        customer_id = request.data.get("customer_id") or session.customer_id or None
        if customer_id and not request.user.is_staff:
            allowed = set(str(x) for x in get_accessible_customer_ids(request.user))
            if str(customer_id) not in allowed:
                return _forbidden()
            
        run = create_chat_run(
            user=request.user,
            session=session,
            request_id=request_id,
            client_tab_id=client_tab_id,
            page_type=request.data.get("page_type") or session.page_type,
            object_id=request.data.get("object_id") or session.object_id,
            current_tab=request.data.get("current_tab") or "",
            inclusions=request.data.get("inclusions") or [],
            customer_id=customer_id,
            message=message,
            template_code=template_code or None,
            chat_command=chat_command or None,
            variables=request.data.get("variables") or None,
        )

        try:
            task = execute_chat_run_task.delay(str(run.id))
            run.worker_task_id = task.id or ""
            run.provider_execution = {
                **(run.provider_execution or {}),
                "ui_progress": {
                    "label": "Queued…",
                    "preview": "",
                    "updated_at": timezone.now().isoformat(),
                },
            }
            run.save(update_fields=["worker_task_id", "provider_execution", "updated_at"])
        except Exception:
            execute_chat_run(run)
            run.refresh_from_db()
            return Response(ChatRunSerializer(run).data, status=status.HTTP_201_CREATED)

        run.refresh_from_db()
        return Response(ChatRunSerializer(run).data, status=status.HTTP_201_CREATED)


class ChatRunDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, run_id):
        if not _has_any_chat_run_perm(request.user):
            return _forbidden()
        
        run = ChatRun.objects.filter(id=run_id, user=request.user).first()
        if not run:
            return Response({"detail": "Run not found"}, status=status.HTTP_404_NOT_FOUND)

        refresh_chat_run_actions(run)
        run.refresh_from_db()
        return Response(ChatRunSerializer(run).data)


class ChatRunCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, run_id):
        if not _has_any_chat_run_perm(request.user):
            return _forbidden()
        
        run = ChatRun.objects.filter(id=run_id, user=request.user).first()
        if not run:
            return Response({"detail": "Run not found"}, status=status.HTTP_404_NOT_FOUND)

        if run.status in {"completed", "failed", "cancelled"}:
            return Response(ChatRunSerializer(run).data, status=status.HTTP_200_OK)

        run.cancel_requested = True
        run.cancel_requested_at = timezone.now()
        run.save(update_fields=["cancel_requested", "cancel_requested_at", "updated_at"])

        return Response(ChatRunSerializer(run).data, status=status.HTTP_200_OK)
    

class ChatGenerateDraftView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, run_id):
        if not user_has_perm(request.user, "chat.use"):
            return _forbidden()
        
        run = ChatRun.objects.filter(id=run_id, user=request.user).first()
        if not run:
            return Response({"detail": "Run not found"}, status=status.HTTP_404_NOT_FOUND)
        target_type = request.data.get("target_type")
        target_id = str(request.data.get("target_id") or "").strip()

        allowed_target_types = {"case_comment", "alert_comment", "hunt_note"}
        if target_type not in allowed_target_types:
            return Response({"detail": "Invalid target_type."}, status=status.HTTP_400_BAD_REQUEST)

        if not target_id:
            return Response({"detail": "target_id is required."}, status=status.HTTP_400_BAD_REQUEST)
        

        if target_type == "case_comment" and not user_has_perm(request.user, "chat.comment.case.generate"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if target_type == "alert_comment" and not user_has_perm(request.user, "chat.comment.alert.generate"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if target_type == "hunt_note" and not user_has_perm(request.user, "chat.comment.hunt.generate"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if not user_can_access_draft_target(request.user, target_type, target_id):
            return _forbidden()

        draft = generate_comment_draft(run=run, target_type=target_type, target_id=target_id)
        return Response({
            "id": str(draft.id),
            "target_type": draft.target_type,
            "target_id": draft.target_id,
            "content": draft.content,
            "is_posted": draft.is_posted,
        }, status=status.HTTP_201_CREATED)


class ChatPostDraftView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, draft_id):
        if not user_has_perm(request.user, "chat.use"):
            return _forbidden()
        
        draft = ChatGeneratedDraft.objects.filter(id=draft_id, run__user=request.user).select_related("run").first()
        if not draft:
            return Response({"detail": "Draft not found"}, status=status.HTTP_404_NOT_FOUND)

        allowed_target_types = {"case_comment", "alert_comment", "hunt_note"}
        if draft.target_type not in allowed_target_types:
            return Response({"detail": "Invalid target_type."}, status=status.HTTP_400_BAD_REQUEST)
        
        
        if draft.target_type == "case_comment" and not user_has_perm(request.user, "chat.comment.case.post"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if draft.target_type == "alert_comment" and not user_has_perm(request.user, "chat.comment.alert.post"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if draft.target_type == "hunt_note" and not user_has_perm(request.user, "chat.comment.hunt.post"):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        
        post_generated_draft(user=request.user, draft=draft)
        return Response({"ok": True})


class ChatActionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (
            user_has_perm(request.user, "chat.soar.use")
            or user_has_perm(request.user, "chat.template.manage")
        ):
            return _forbidden()
        
        templates = (
            InvestigationTemplate.objects
            .filter(is_enabled=True)
            .select_related("soar_provider")
            .order_by("name")
        )

        data = [
            {
                "code": item.code,
                "name": item.name,
                "description": item.description,
                "chat_command": item.chat_command or "",
                "command_help": item.command_help or "",
                "entity_type": item.entity_type,
                "target_kind": item.target_kind,
                "soar_provider_name": item.soar_provider.name if item.soar_provider_id else "",
                "default_variables": item.default_variables or {},
                "allowed_variables_schema": item.allowed_variables_schema or {},
                "prompt_overrides_schema": item.prompt_overrides_schema or {},
            }
            for item in templates
            if item.chat_command
        ]

        return Response(data)