/** Match SalesPulse login: treat missing status as active; hide inactive only. */
export function isActiveBusiness(business: { status?: unknown }): boolean {
  const status = business.status;
  if (status == null || status === '') return true;
  return String(status).toLowerCase() !== 'inactive';
}

export function filterActiveBusinesses<T extends { status?: unknown }>(businesses: T[]): T[] {
  return businesses.filter(isActiveBusiness);
}
