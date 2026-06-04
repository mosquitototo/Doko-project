from django.utils import timezone

from .models import Alert, AlertComment, ChatGeneratedDraft, Comment, Event, Hunt, HuntJournalEntry
from .rbac import user_has_perm, get_accessible_customer_ids
from .html_sanitizer import sanitize_html


def _accessible_customer_filter(user):
    if user.is_staff:
        return None

    return list(get_accessible_customer_ids(user))


def _get_accessible_case(user, object_id):
    qs = Event.objects.filter(id=object_id, is_deleted=False)

    if user.is_staff:
        return qs.first()

    customer_ids = _accessible_customer_filter(user)
    if not customer_ids:
        return None

    return qs.filter(customer_id__in=customer_ids).first()


def _get_accessible_alert(user, object_id):
    qs = Alert.objects.filter(id=object_id, is_deleted=False)

    if user.is_staff:
        return qs.first()

    customer_ids = _accessible_customer_filter(user)
    if not customer_ids:
        return None

    return qs.filter(customer_id__in=customer_ids).first()


def _get_accessible_hunt(user, object_id):
    qs = Hunt.objects.filter(id=object_id, is_deleted=False)

    if user.is_staff:
        return qs.first()

    customer_ids = _accessible_customer_filter(user)
    if not customer_ids:
        return None

    return qs.filter(customer_id__in=customer_ids).first()


def user_can_access_draft_target(user, target_type: str, target_id: str) -> bool:
    if target_type == "case_comment":
        return _get_accessible_case(user, target_id) is not None

    if target_type == "alert_comment":
        return _get_accessible_alert(user, target_id) is not None

    if target_type == "hunt_note":
        return _get_accessible_hunt(user, target_id) is not None

    return False


def post_generated_draft(*, user, draft: ChatGeneratedDraft):
    if draft.is_posted:
        return draft

    if draft.target_type == "case_comment":
        if not user_has_perm(user, "chat.comment.case.post"):
            raise PermissionError("You do not have permission to post case comments")

        case = _get_accessible_case(user, draft.target_id)
        if not case:
            raise PermissionError("You do not have access to this case")
        
        sanitized_content = sanitize_html(draft.content)
        Comment.objects.create(
            event=case,
            author=None,
            author_label="Catbot",
            text=sanitized_content,
        )

    elif draft.target_type == "alert_comment":
        if not user_has_perm(user, "chat.comment.alert.post"):
            raise PermissionError("You do not have permission to post alert comments")

        alert = _get_accessible_alert(user, draft.target_id)
        if not alert:
            raise PermissionError("You do not have access to this alert")

        sanitized_content = sanitize_html(draft.content)
        AlertComment.objects.create(
            alert=alert,
            author=None,
            author_label="Catbot",
            text=sanitized_content,
        )

    elif draft.target_type == "hunt_note":
        if not user_has_perm(user, "chat.comment.hunt.post"):
            raise PermissionError("You do not have permission to post hunt notes")

        hunt = _get_accessible_hunt(user, draft.target_id)
        if not hunt:
            raise PermissionError("You do not have access to this hunt")

        sanitized_content = sanitize_html(draft.content)
        HuntJournalEntry.objects.create(
            hunt=hunt,
            author=user,
            entry_type=HuntJournalEntry.EntryType.NOTE,
            text=sanitized_content,
        )

    else:
        raise ValueError("Unsupported draft target type")

    draft.is_posted = True
    draft.posted_at = timezone.now()
    draft.save(update_fields=["is_posted", "posted_at"])
    return draft