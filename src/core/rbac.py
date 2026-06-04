from django.db import models
from django.db.models import Q

from .models import Permission, Role, CustomerAccess


CUSTOMER_SCOPED_PREFIXES = ("case.", "alert.", "hunt.", "task.")


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
    non_customer_scoped = {
        code for code in all_role_permissions
        if not _is_customer_scoped_perm(code)
    }

    global_roles = roles_qs.filter(customer_access_rules__isnull=True).distinct()
    global_role_permissions = _roles_to_perm_codes(global_roles)
    global_customer_scoped = {
        code for code in global_role_permissions
        if _is_customer_scoped_perm(code)
    }

    return non_customer_scoped | global_customer_scoped


def _scoped_role_permissions(user, roles_qs, customer_id) -> set[str]:
    if not customer_id:
        return set()

    role_ids = roles_qs.values_list("id", flat=True)

    scoped_roles = (
        Role.objects
        .filter(
            Q(
                customer_access_rules__customer_id=customer_id,
                customer_access_rules__user=user,
            )
            | Q(
                customer_access_rules__customer_id=customer_id,
                customer_access_rules__user__isnull=True,
                customer_access_rules__role_id__in=role_ids,
            )
        )
        .distinct()
    )

    return _roles_to_perm_codes(scoped_roles)


def get_user_permissions(user, customer_id=None) -> set[str]:
    if not user or not getattr(user, "is_authenticated", False):
        return set()

    if not getattr(user, "is_active", False):
        return set()

    if getattr(user, "is_staff", False):
        return {"*"}

    assigned_roles = _assigned_roles(user)
    perms = _global_role_permissions(assigned_roles)

    if customer_id:
        perms |= _scoped_role_permissions(user, assigned_roles, customer_id)
    else:
        accessible_customer_ids = get_accessible_customer_ids(user)
        if accessible_customer_ids:
            visible_scoped_roles = (
                assigned_roles
                .filter(customer_access_rules__customer_id__in=accessible_customer_ids)
                .distinct()
            )
            perms |= {
                code for code in _roles_to_perm_codes(visible_scoped_roles)
                if _is_customer_scoped_perm(code)
            }

    return expand_permissions(perms)


def user_has_perm(user, perm_code: str, customer_id=None) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False

    if not getattr(user, "is_active", False):
        return False

    if getattr(user, "is_staff", False):
        return True

    perm_code = str(perm_code or "").strip()
    if not perm_code:
        return False

    if _is_customer_scoped_perm(perm_code):
        assigned_roles = _assigned_roles(user)

        if customer_id:
            accessible_customer_ids = {str(x) for x in get_accessible_customer_ids(user)}
            if str(customer_id) not in accessible_customer_ids:
                return False

            perms = _global_role_permissions(assigned_roles)
            perms |= _scoped_role_permissions(user, assigned_roles, customer_id)
            perms = expand_permissions(perms)
            return "*" in perms or perm_code in perms

        global_perms = expand_permissions(_global_role_permissions(assigned_roles))
        return "*" in global_perms or perm_code in global_perms

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

    if getattr(user, "is_staff", False):
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


def user_has_any_chat_access(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False

    if not getattr(user, "is_active", False):
        return False

    if getattr(user, "is_staff", False):
        return True

    perms = get_user_permissions(user)
    return any(code.startswith("chat.") for code in perms)