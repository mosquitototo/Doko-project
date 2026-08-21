from django.db import models
from django.db.models import Q

from .models import Permission, Role, CustomerAccess


CUSTOMER_SCOPED_PREFIXES = (
    "case.",
    "alert.",
    "hunt.",
    "task.",
    "chat.read.case",
    "chat.read.alert",
    "chat.read.hunt",
    "chat.read.task",
    "chat.read.dashboard",
    "chat.comment.case.",
    "chat.comment.alert.",
    "chat.comment.hunt.",
)


def is_doko_admin(user) -> bool:
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and getattr(user, "is_active", False)
        and getattr(user, "is_staff", False)
    )


def _is_customer_scoped_perm(code: str) -> bool:
    return str(code or "").startswith(CUSTOMER_SCOPED_PREFIXES)


def expand_permissions(perms: set[str]) -> set[str]:
    manage_implies_view = [
        "settings.access.users",
        "settings.access.roles",
        "settings.data_models",
        "settings.reports",
        "settings.customers",
        "settings.workbooks",
        "settings.connectors",
        "settings.case_management",
        "settings.aisoar",
        "settings.automation_rules",
    ]

    for base in manage_implies_view:
        if f"{base}.manage" in perms:
            perms.add(f"{base}.view")

    delete_implies_manage = [
        "settings.access.users",
        "settings.access.roles",
        "settings.data_models",
        "settings.reports",
        "settings.customers",
        "settings.workbooks",
        "settings.connectors",
    ]

    for base in delete_implies_manage:
        if f"{base}.delete" in perms:
            perms.add(f"{base}.manage")
            perms.add(f"{base}.view")

    if any(code.startswith("chat.") for code in perms):
        perms.add("chat.use")

    if "task.manage" in perms:
        perms.update({"task.view", "task.add"})

    return perms


def _roles_to_perm_codes(roles_qs) -> set[str]:
    codes = (
        Permission.objects
        .filter(roles__in=roles_qs)
        .distinct()
        .values_list("code", flat=True)
    )
    return set(codes)


def _assigned_roles(user):
    return Role.objects.filter(user_roles__user=user).distinct()


def _global_role_permissions(roles_qs) -> set[str]:
    all_role_permissions = _roles_to_perm_codes(roles_qs)
    return {
        code for code in all_role_permissions
        if not _is_customer_scoped_perm(code)
    }


def _scoped_role_permissions(user, roles_qs, customer_id) -> set[str]:
    if not customer_id:
        return set()

    role_ids = list(roles_qs.values_list("id", flat=True))
    direct_access = CustomerAccess.objects.filter(
        customer_id=customer_id,
        user=user,
    ).exists()

    scoped_roles = roles_qs if direct_access else Role.objects.none()
    role_scoped = roles_qs.filter(
        customer_access_rules__customer_id=customer_id,
        customer_access_rules__user__isnull=True,
        customer_access_rules__role_id__in=role_ids,
    )
    scoped_roles = (scoped_roles | role_scoped).distinct()

    return _roles_to_perm_codes(scoped_roles)


def get_user_permissions(user, customer_id=None) -> set[str]:
    if not user or not getattr(user, "is_authenticated", False):
        return set()

    if not getattr(user, "is_active", False):
        return set()

    if is_doko_admin(user):
        return {"*"}

    assigned_roles = _assigned_roles(user)
    perms = _global_role_permissions(assigned_roles)

    if customer_id:
        perms |= _scoped_role_permissions(user, assigned_roles, customer_id)
    return expand_permissions(perms)


def get_user_permission_codes_for_display(user) -> set[str]:
    perms = get_user_permissions(user)
    if not user or not getattr(user, "is_authenticated", False) or is_doko_admin(user):
        return perms

    assigned_roles = _assigned_roles(user)
    accessible_customer_ids = get_accessible_customer_ids(user)
    for customer_id in accessible_customer_ids:
        perms |= {
            code
            for code in _scoped_role_permissions(user, assigned_roles, customer_id)
            if _is_customer_scoped_perm(code)
        }
    return expand_permissions(perms)


def user_has_perm(user, perm_code: str, customer_id=None) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False

    if not getattr(user, "is_active", False):
        return False

    if is_doko_admin(user):
        return True

    perm_code = str(perm_code or "").strip()
    if not perm_code:
        return False

    if _is_customer_scoped_perm(perm_code):
        if customer_id:
            return str(customer_id) in {
                str(value) for value in get_permitted_customer_ids(user, perm_code)
            }
        return False

    perms = get_user_permissions(user, customer_id=None)
    return "*" in perms or perm_code in perms


def get_accessible_customer_ids(user):
    if not user or not getattr(user, "is_authenticated", False):
        return []

    if not getattr(user, "is_active", False):
        return []

    cache_attr = "_cached_accessible_customer_ids"
    cached = getattr(user, cache_attr, None)
    if cached is not None:
        return cached

    if is_doko_admin(user):
        from .models import Customer
        result = list(Customer.objects.values_list("id", flat=True))
    else:
        role_ids = list(
            Role.objects
            .filter(user_roles__user=user)
            .values_list("id", flat=True)
            .distinct()
        )

        qs = (
            CustomerAccess.objects
            .filter(Q(user=user) | Q(user__isnull=True, role_id__in=role_ids))
            .values_list("customer_id", flat=True)
        )

        result = list(set(qs))

    setattr(user, cache_attr, result)
    return result


def get_permitted_customer_ids(user, perm_code: str):
    if not user or not getattr(user, "is_authenticated", False):
        return []

    if not getattr(user, "is_active", False):
        return []

    if is_doko_admin(user):
        from .models import Customer
        return list(Customer.objects.values_list("id", flat=True))

    perm_code = str(perm_code or "").strip()
    if not perm_code or not _is_customer_scoped_perm(perm_code):
        return []

    equivalent_codes = {perm_code}
    if perm_code in {"task.view", "task.add"}:
        equivalent_codes.add("task.manage")

    assigned_roles = _assigned_roles(user)
    permitted_roles = assigned_roles.filter(
        permissions__code__in=equivalent_codes,
    ).distinct()
    if not permitted_roles.exists():
        return []

    direct_customer_ids = CustomerAccess.objects.filter(
        user=user,
    ).values_list("customer_id", flat=True)
    role_customer_ids = CustomerAccess.objects.filter(
        user__isnull=True,
        role__in=permitted_roles,
    ).values_list("customer_id", flat=True)

    return list(set(direct_customer_ids) | set(role_customer_ids))
