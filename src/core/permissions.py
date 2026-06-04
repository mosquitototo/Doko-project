from __future__ import annotations

from uuid import UUID

from rest_framework.permissions import BasePermission

from .rbac import user_has_perm, get_accessible_customer_ids



def _as_uuid_str(val) -> str | None:
    if not val:
        return None
    try:
        return str(UUID(str(val)))
    except Exception:
        return None


class IsOwner(BasePermission):
    def has_object_permission(self, request, view, obj) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True
        return getattr(obj, "owner_id", None) == user.id


class IsOwnerOrMember(BasePermission):
    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True
        if getattr(obj, "owner_id", None) == user.id:
            return True
        members = getattr(obj, "members", None)
        return bool(members and members.filter(id=user.id).exists())


class HasPermissionCode(BasePermission):

    def _extract_customer_id(self, request, view) -> str | None:
        kw = getattr(view, "customer_id_kwarg", None)
        if kw:
            return _as_uuid_str(getattr(view, "kwargs", {}).get(kw))

        event_kw = getattr(view, "event_id_kwarg", None) or getattr(view, "case_id_kwarg", None)
        if event_kw:
            eid = getattr(view, "kwargs", {}).get(event_kw)
            eid = _as_uuid_str(eid)
            if eid:
                try:
                    from .models import Event
                    cid = (
                        Event.objects
                        .filter(id=eid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None
                except Exception:
                    return None

        alert_kw = getattr(view, "alert_id_kwarg", None)
        if alert_kw:
            aid = getattr(view, "kwargs", {}).get(alert_kw)
            aid = _as_uuid_str(aid)
            if aid:
                try:
                    from .models import Alert
                    cid = (
                        Alert.objects
                        .filter(id=aid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None
                except Exception:
                    return None
                
        hunt_kw = getattr(view, "hunt_id_kwarg", None)
        if hunt_kw:
            hid = getattr(view, "kwargs", {}).get(hunt_kw)
            hid = _as_uuid_str(hid)
            if hid:
                try:
                    from .models import Hunt
                    cid = (
                        Hunt.objects
                        .filter(id=hid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None
                except Exception:
                    return None
                
        pk = getattr(view, "kwargs", {}).get("pk")
        pk_uuid = _as_uuid_str(pk)
        if pk_uuid:
            required = (getattr(view, "required_permission", "") or "").strip()
            try:
                if required.startswith("case."):
                    from .models import Event
                    cid = (
                        Event.objects
                        .filter(id=pk_uuid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None

                if required.startswith("alert."):
                    from .models import Alert
                    cid = (
                        Alert.objects
                        .filter(id=pk_uuid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None
                
                if required.startswith("hunt."):
                    from .models import Hunt
                    cid = (
                        Hunt.objects
                        .filter(id=pk_uuid, is_deleted=False)
                        .values_list("customer_id", flat=True)
                        .first()
                    )
                    return str(cid) if cid else None
                
            except Exception:
                return None

        required = (getattr(view, "required_permission", "") or "").strip()
        if required.startswith(("case.", "alert.", "hunt.", "task.")):
            cid = (
                request.query_params.get("customer")
                or request.query_params.get("customer_id")
                or ""
            ).strip()
            return _as_uuid_str(cid)

        return None
    

    def _accessible_customers(self, user):
        return [str(x) for x in (get_accessible_customer_ids(user) or [])]

    def _has_perm_for_any_accessible_customer(self, user, perm_code: str) -> bool:
        if user_has_perm(user, perm_code, customer_id=None):
            return True

        from .models import CustomerAccess, Permission, Role
        from django.db.models import Q

        role_ids = list(
            Role.objects
            .filter(user_roles__user=user)
            .values_list("id", flat=True)
            .distinct()
        )

        if not role_ids:
            return False

        scoped_customer_ids = list(
            CustomerAccess.objects
            .filter(Q(user=user) | Q(user__isnull=True, role_id__in=role_ids))
            .values_list("customer_id", flat=True)
            .distinct()
        )

        if not scoped_customer_ids:
            return False

        return (
            Permission.objects
            .filter(code=perm_code)
            .filter(
                roles__customer_access_rules__customer_id__in=scoped_customer_ids,
            )
            .filter(
                Q(roles__customer_access_rules__user=user)
                | Q(
                    roles__customer_access_rules__user__isnull=True,
                    roles__customer_access_rules__role_id__in=role_ids,
                )
            )
            .exists()
        )

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True

        required = getattr(view, "required_permission", None)
        if not required:
            return False

        customer_id = self._extract_customer_id(request, view)

        if customer_id:
            cids = self._accessible_customers(user)
            if customer_id not in cids:
                return False
            return user_has_perm(user, required, customer_id=customer_id)

        if required.startswith(("case.", "alert.", "hunt.", "task.")):
            cids = self._accessible_customers(user)
            if not cids:
                return False
            return self._has_perm_for_any_accessible_customer(user, required)

        return user_has_perm(user, required, customer_id=None)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True

        required = getattr(view, "required_permission", None)
        if not required:
            return False

        cid = getattr(obj, "customer_id", None)
        if not cid and getattr(obj, "event", None):
            cid = getattr(obj.event, "customer_id", None)
        if not cid and getattr(obj, "case", None):
            cid = getattr(obj.case, "customer_id", None)
        if not cid and getattr(obj, "alert", None):
            cid = getattr(obj.alert, "customer_id", None)

        cid = _as_uuid_str(cid)

        if cid:
            cids = self._accessible_customers(user)
            if cid not in cids:
                return False
            return user_has_perm(user, required, customer_id=cid)

        return user_has_perm(user, required, customer_id=None)


class CanManageInstanceSettings(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "is_staff", False):
            return True
        return user_has_perm(user, "settings.instance.manage")