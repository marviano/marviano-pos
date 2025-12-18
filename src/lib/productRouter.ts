/**
 * Product Router Utility
 * Determines which display (kitchen or barista) a product should be routed to
 * based on category1_id
 */

import type { OrderItem as NetworkOrderItem } from './networkClient';

export type ProductDestination = 'kitchen' | 'barista' | null;

export interface Product {
  id: number;
  category1_id: number | null;
  [key: string]: unknown; // Allow other product properties
}

export type OrderItem = NetworkOrderItem;

/**
 * Get product destination based on category1_id
 * - category1_id = 1 (makanan) → kitchen
 * - category1_id = 2 (minuman) → barista
 * - null or other values → null (skip routing)
 */
export function getProductDestination(category1_id: number | null): ProductDestination {
  if (category1_id === null || category1_id === undefined) {
    return null;
  }

  if (category1_id === 1) {
    return 'kitchen';
  }

  if (category1_id === 2) {
    return 'barista';
  }

  // Unknown category1_id - skip routing
  return null;
}

/**
 * Get product destination from product object
 */
export function getProductDestinationFromProduct(product: Product): ProductDestination {
  return getProductDestination(product.category1_id);
}

/**
 * Route order items into kitchen and barista arrays
 * Filters out items with null/invalid category1_id
 */
export function routeOrderItems(items: OrderItem[]): {
  kitchen: OrderItem[];
  barista: OrderItem[];
  skipped: OrderItem[];
} {
  const kitchen: OrderItem[] = [];
  const barista: OrderItem[] = [];
  const skipped: OrderItem[] = [];

  items.forEach((item) => {
    const destination = getProductDestination(item.category1_id);

    switch (destination) {
      case 'kitchen':
        kitchen.push(item);
        break;
      case 'barista':
        barista.push(item);
        break;
      case null:
        skipped.push(item);
        break;
    }
  });

  return { kitchen, barista, skipped };
}

/**
 * Check if an order has items for kitchen
 */
export function hasKitchenItems(items: OrderItem[]): boolean {
  return items.some((item) => getProductDestination(item.category1_id) === 'kitchen');
}

/**
 * Check if an order has items for barista
 */
export function hasBaristaItems(items: OrderItem[]): boolean {
  return items.some((item) => getProductDestination(item.category1_id) === 'barista');
}

/**
 * Get destination name for display
 */
export function getDestinationName(destination: ProductDestination): string {
  switch (destination) {
    case 'kitchen':
      return 'Kitchen';
    case 'barista':
      return 'Barista';
    case null:
      return 'None';
  }
}
