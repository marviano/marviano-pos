import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

interface CustomizationTypeRow {
  id: number;
  name: string;
  selection_mode: 'single' | 'multiple';
}

interface CustomizationOptionRow {
  id: number;
  type_id: number;
  name: string;
  price_adjustment: number;
}

interface ProductCustomizationRow {
  id: number;
  product_id: number;
  customization_type_id: number;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const productId = parseInt(id);
    
    if (isNaN(productId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid product ID' },
        { status: 400 }
      );
    }

    // Get all customization types linked to this product
    const customizationTypes = await query<CustomizationTypeRow[]>(
      `SELECT DISTINCT ct.id, ct.name, ct.selection_mode
       FROM product_customization_types ct
       INNER JOIN product_customizations pc ON ct.id = pc.customization_type_id
       WHERE pc.product_id = ?
       ORDER BY ct.name ASC`,
      [productId]
    );

    // Get all options for each customization type
    const customizationOptions = await query<CustomizationOptionRow[]>(
      `SELECT co.id, co.type_id, co.name, co.price_adjustment
       FROM product_customization_options co
       INNER JOIN product_customizations pc ON co.type_id = pc.customization_type_id
       WHERE pc.product_id = ?
       ORDER BY co.type_id, co.name ASC`,
      [productId]
    );

    // Group options by customization type
    const customizations = customizationTypes.map(type => ({
      id: type.id,
      name: type.name,
      selection_mode: type.selection_mode,
      options: customizationOptions.filter(option => option.type_id === type.id).map(option => ({
        ...option,
        price_adjustment: Number(option.price_adjustment)
      }))
    }));

    return NextResponse.json({
      success: true,
      customizations: customizations
    });

  } catch (error: any) {
    // If it's a connection error, return a different status so the frontend knows to fallback
    if (error?.code === 'ENETUNREACH' || error?.errno === -4062) {
      return NextResponse.json(
        { success: false, error: 'Connection failed - please try offline mode' },
        { status: 503 } // Service Unavailable
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch product customizations',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
