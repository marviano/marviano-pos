import { User, isSuperAdmin } from './auth';

/**
 * Check if a user has a specific permission
 * Super admin always returns true
 * Otherwise checks if permission exists in user's permissions
 * and if permission is linked to selected business or is global (business_id is null)
 */
export function hasPermission(
  user: User | null,
  permissionName: string
): boolean {
  if (!user) {
    return false;
  }

  // Super admin has access to everything
  if (isSuperAdmin(user)) {
    return true;
  }

  // Check if user has the permission
  return user.permissions.includes(permissionName);
}

/**
 * Get filtered permissions based on selected business
 * For super admin: returns all permissions
 * For non-super admin: returns permissions where:
 *   - business_id matches selectedBusinessId, OR
 *   - business_id is NULL (global permissions)
 */
export function getFilteredPermissions(
  user: User | null,
  allPermissionsWithBusiness: Array<{ name: string; business_id: number | null }>
): string[] {
  if (!user) {
    return [];
  }

  // Super admin gets all permissions
  if (isSuperAdmin(user)) {
    return allPermissionsWithBusiness.map(p => p.name);
  }

  // For non-super admin, filter by selected business
  const selectedBusinessId = user.selectedBusinessId;
  
  return allPermissionsWithBusiness
    .filter(permission => {
      // Include global permissions (business_id is null)
      if (permission.business_id === null) {
        return true;
      }
      // Include permissions for selected business
      if (selectedBusinessId !== null && permission.business_id === selectedBusinessId) {
        return true;
      }
      return false;
    })
    .map(p => p.name);
}

