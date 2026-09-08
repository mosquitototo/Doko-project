export type CustomerScope = { customer: string | null; subgroups: string[] };

export function selectCustomerScope(customer: string | null): CustomerScope {
  return { customer, subgroups: [] };
}

export function toggleCustomerSubgroup(scope: CustomerScope, customer: string, subgroup: string): CustomerScope {
  if (scope.customer !== customer) return { customer, subgroups: [subgroup] };
  return {
    customer,
    subgroups: scope.subgroups.includes(subgroup)
      ? scope.subgroups.filter((id) => id !== subgroup)
      : [...scope.subgroups, subgroup],
  };
}

export function customerSubgroupNames(
  customers: { id: string; subgroups?: { id: string; name: string }[] }[],
  scope: CustomerScope,
): string[] {
  if (!scope.customer) return [];
  const subgroups = customers.find((customer) => customer.id === scope.customer)?.subgroups ?? [];
  return scope.subgroups.map((id) => subgroups.find((subgroup) => subgroup.id === id)?.name ?? "Unavailable subgroup");
}
