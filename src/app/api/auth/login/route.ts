import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/db';

interface User {
  id: number;
  email: string;
  name: string;
  password: string;
  role_id: number;
  organization_id: number;
}

interface Role {
  id: number;
  name: string;
}

interface PermissionRow {
  name: string;
  business_id: number | null;
}

interface BusinessRow {
  id: number;
  name: string;
  permission_name: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Find user by email
    const users = await query<User[]>(
      'SELECT id, email, name, password, role_id, organization_id FROM users WHERE email = ?',
      [email]
    );

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const user = users[0];

    // Check if password is set
    if (!user.password) {
      return NextResponse.json(
        { error: 'Password not set for this user. Please contact administrator.' },
        { status: 401 }
      );
    }

    // Verify password using bcrypt
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Get user role
    const roles = await query<Role[]>(
      'SELECT id, name FROM roles WHERE id = ?',
      [user.role_id]
    );

    const roleName = roles.length > 0 ? roles[0].name : 'cashier';
    const isSuperAdmin = roleName.toLowerCase() === 'super admin';

    // Get permissions for the user's role (including business_id)
    const permissionRows = user.role_id
      ? await query<PermissionRow[]>(
          `SELECT p.name, p.business_id
           FROM permissions p
           INNER JOIN role_permissions rp ON rp.permission_id = p.id
           WHERE rp.role_id = ? AND (p.status IS NULL OR p.status = 'active')`,
          [user.role_id]
        )
      : [];

    const permissions = permissionRows.map(permission => permission.name);

    // Get businesses for selection
    let businesses: BusinessRow[] = [];
    
    if (isSuperAdmin) {
      // Super admin: Get all active businesses
      businesses = await query<BusinessRow[]>(
        `SELECT id, name, permission_name
         FROM businesses
         WHERE status = 'active'
         ORDER BY name ASC`
      );
    } else {
      // Non-super admin: Get businesses from permissions
      const businessIds = permissionRows
        .filter(p => p.business_id !== null)
        .map(p => p.business_id as number);
      
      if (businessIds.length > 0) {
        // Get distinct business IDs and filter by active status
        const uniqueBusinessIds = Array.from(new Set(businessIds));
        const placeholders = uniqueBusinessIds.map(() => '?').join(',');
        
        businesses = await query<BusinessRow[]>(
          `SELECT id, name, permission_name
           FROM businesses
           WHERE id IN (${placeholders}) AND status = 'active'
           ORDER BY name ASC`,
          uniqueBusinessIds
        );
      }
    }

    // Return user data (without password)
    return NextResponse.json({
      success: true,
      user: {
        id: user.id.toString(),
        email: user.email,
        username: user.email,
        name: user.name || user.email,
        role: roleName.toLowerCase() as 'admin' | 'cashier' | 'manager',
        role_name: roleName,
        organization_id: user.organization_id,
        role_id: user.role_id,
        permissions,
      },
      businesses,
      isSuperAdmin,
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
