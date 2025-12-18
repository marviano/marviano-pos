/**
 * Data Fetcher with Offline Support
 * Automatically falls back to local SQLite database when offline
 */

import { getApiUrl } from '@/lib/api';

type UnknownRecord = Record<string, unknown>;

const isElectron = typeof window !== 'undefined' && (window as { electronAPI?: UnknownRecord }).electronAPI;

export interface Product {
  id: number;
  menu_code: string;
  nama: string;
  satuan: string;
  category1_id: number | null;
  category2_id: number | null;
  category1_name: string | null;
  category2_name: string | null;
  keterangan: string | null;
  harga_beli: number | null;
  ppn: number | null;
  harga_jual: number;
  harga_khusus: number | null;
  harga_gofood: number | null;
  harga_grabfood: number | null;
  harga_shopeefood: number | null;
  harga_tiktok: number | null;
  harga_qpon: number | null;
  fee_kerja: number | null;
  image_url: string | null;
  status: 'active' | 'inactive';
}

export interface Category {
  jenis: string;
  active?: boolean;
}

/**
 * Fetch products with offline fallback
 */
export async function fetchProducts(
  category2Name?: string,
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, forceOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Product[]> {

  // If we're in offline mode (isOnline is false), skip API call entirely
  if (options?.isOnline === false) {
    return await fetchFromLocalDatabase(category2Name, transactionType, options);
  }

  // For online tabs (qpon, gofood, etc), prioritize fetching from offline database first
  // to ensure instant loading, then optionally refresh from online in background
  if (options?.platform) {
    // Attempt to fetch locally first
    const localProducts = await fetchFromLocalDatabase(category2Name, transactionType, options);

    // If we have local data, return it immediately
    if (localProducts.length > 0) {

      // Trigger background refresh if online
      // We use a non-blocking promise here
      if (options.isOnline) {
        // Define a separate function for the background fetch to avoid recursive loops if we called fetchProducts
        const backgroundRefresh = async () => {
          try {
            let url = category2Name ? getApiUrl(`/api/products?category2_name=${encodeURIComponent(category2Name)}`) : getApiUrl('/api/products');
            if (options?.businessId) url += (url.includes('?') ? '&' : '?') + `businessId=${options.businessId}`;
            if (transactionType) url += (url.includes('?') ? '&' : '?') + `transaction_type=${transactionType}`;
            if (options?.isOnline) url += (url.includes('?') ? '&' : '?') + `online=true`;
            if (options?.platform) url += (url.includes('?') ? '&' : '?') + `platform=${options.platform}`;

            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.products && isElectron) {
                const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
                if (electronAPI?.localDbUpsertProducts) {
                  await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.products);
                  // Dispatch event to update UI if needed
                  window.dispatchEvent(new CustomEvent('dataSynced'));
                }
              }
            }
          } catch (e) {
            console.warn('Background refresh failed:', e);
          }
        };
        backgroundRefresh();
      }

      return localProducts;
    }
    // If local is empty, fall through to online fetch below
  }

  try {
    // Try online fetch first
    let url = category2Name ? getApiUrl(`/api/products?category2_name=${encodeURIComponent(category2Name)}`) : getApiUrl('/api/products');
    if (options?.businessId) {
      url += (url.includes('?') ? '&' : '?') + `businessId=${options.businessId}`;
    }
    if (transactionType) {
      url += (url.includes('?') ? '&' : '?') + `transaction_type=${transactionType}`;
    }
    if (options?.isOnline) {
      url += (url.includes('?') ? '&' : '?') + `online=true`;
    }
    if (options?.platform) {
      url += (url.includes('?') ? '&' : '?') + `platform=${options.platform}`;
    }

    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Network request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.success && data.products) {

      // If we got online data successfully, cache it locally
      if (isElectron) {
        try {
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbUpsertProducts) {
            await (electronAPI.localDbUpsertProducts as (rows: unknown[]) => Promise<{ success: boolean }>)(data.products);
          }
        } catch (error) {
          console.warn('⚠️ Failed to cache products locally:', error);
        }
      }

      return data.products;
    }

    throw new Error('Invalid response format: ' + JSON.stringify(data));
  } catch (error) {
    console.error('❌ [ONLINE FETCH] Error occurred:', error);

    // If forceOnline is true, don't fall back to offline data
    if (options?.forceOnline) {
      return [];
    }

    console.warn('⚠️ Online fetch failed, using offline data:', error);
    return await fetchFromLocalDatabase(category2Name, transactionType, options);
  }
}

/**
 * Fetch products from local SQLite database
 */
async function fetchFromLocalDatabase(
  category2Name?: string,
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, forceOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
): Promise<Product[]> {
  // Fall back to local SQLite database
  if (isElectron) {
    try {
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      let products: UnknownRecord[] = [];
      if (category2Name && electronAPI?.localDbGetProductsByCategory2) {
        const result = await (electronAPI.localDbGetProductsByCategory2 as (category2Name: string) => Promise<unknown[]>)(category2Name);
        products = Array.isArray(result) ? result as UnknownRecord[] : [];
      } else if (electronAPI?.localDbGetAllProducts) {
        const result = await (electronAPI.localDbGetAllProducts as () => Promise<unknown[]>)();
        products = Array.isArray(result) ? result as UnknownRecord[] : [];
      }

      // Normalize local rows to API shape: ensure category1_name and category2_name exist
      products = products.map((p: UnknownRecord) => ({
        ...p,
        category1_name: p.category1_name ?? p.kategori ?? null, // SQLite uses 'kategori' for category1
        category2_name: p.category2_name ?? p.jenis ?? null,
      }));

      // When no specific category is selected, only show products with valid category2_name
      // This ensures consistency with categories API (which only shows categories with non-null names)
      if (!category2Name) {
        products = products.filter((p: unknown) => {
          const product = p as Product;
          return product.category2_name && product.category2_name.trim() !== '';
        });
      }

      // Filter by transaction type if specified - using category1_name to match API logic
      if (transactionType) {
        // Filter by transaction type: bakery vs drinks - match API logic using category1_name
        if (transactionType === 'drinks') {
          products = products.filter((p: unknown) => {
            const product = p as Product;
            return product.category1_name && (product.category1_name === 'Minuman' || product.category1_name === 'Dessert');
          });
        } else if (transactionType === 'bakery') {
          products = products.filter((p: unknown) => {
            const product = p as Product;
            return product.category1_name === 'Bakery';
          });
        }
      }

      // Apply online/platform filter when in online mode (offline DB)
      if (options?.isOnline && options?.platform) {
        products = products.filter((p: unknown) => {
          const product = p as Product;
          if (options.platform === 'qpon') return product.harga_qpon != null && product.harga_qpon >= 0;
          if (options.platform === 'gofood') return product.harga_gofood != null && product.harga_gofood >= 0;
          if (options.platform === 'grabfood') return product.harga_grabfood != null && product.harga_grabfood >= 0;
          if (options.platform === 'shopeefood') return product.harga_shopeefood != null && product.harga_shopeefood >= 0;
          if (options.platform === 'tiktok') return product.harga_tiktok != null && product.harga_tiktok >= 0;
          return false;
        });
      }
      // Note: If online=true but no platform specified, show all products (no harga_online filter)

      return products as unknown as Product[];
    } catch (localError) {
      console.error('❌ Failed to load from local database:', localError);
    }
  }

  // If everything fails, return empty array
  return [];
}

/**
 * Fetch categories with offline fallback
 */
export async function fetchCategories(
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Category[]> {
  /* console.log('🔍 [FETCH CATEGORIES] Starting fetch with params:', {
    transactionType,
    options,
    isElectron: isElectron
  }); */

  // If we're in offline mode (isOnline is false), skip API call entirely
  if (options?.isOnline === false) {
    // console.log('📱 [OFFLINE MODE] Skipping API call for categories, using local database directly');
    return await fetchCategoriesFromLocalDatabase(transactionType, options);
  }

  try {
    // Try online fetch first
    let url = getApiUrl('/api/categories');
    const params = new URLSearchParams();
    if (options?.businessId) {
      params.append('businessId', String(options.businessId));
    }
    if (transactionType) {
      params.append('transaction_type', transactionType);
    }
    if (options?.isOnline) {
      params.append('online', 'true');
    }
    if (options?.platform) {
      params.append('platform', options.platform);
    }
    if (params.toString()) {
      url += '?' + params.toString();
    }

    console.log('🌐 [ONLINE FETCH] Making API request to:', url);
    const response = await fetch(url, { cache: 'no-store' });

    console.log('🌐 [ONLINE FETCH] Response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Network request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('🌐 [ONLINE FETCH] Response data:', data);

    if (data.success && data.categories) {
      console.log('✅ [ONLINE FETCH] Successfully fetched', data.categories.length, 'categories');

      // If we got online data successfully, cache it locally
      if (isElectron) {
        try {
          const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
          if (electronAPI?.localDbUpsertCategories) {
            await (electronAPI.localDbUpsertCategories as (rows: unknown[]) => Promise<{ success: boolean }>)(
              data.categories.map((cat: Category) => ({
                jenis: cat.jenis,
                updated_at: Date.now(),
              }))
            );
            console.log('✅ Categories cached locally');
          }
        } catch (error) {
          console.warn('⚠️ Failed to cache categories locally:', error);
        }
      }

      return data.categories;
    }

    throw new Error('Invalid response format: ' + JSON.stringify(data));
  } catch (error) {
    console.error('❌ [ONLINE FETCH] Error occurred:', error);
    console.warn('⚠️ Online fetch failed, using offline data:', error);
    return await fetchCategoriesFromLocalDatabase(transactionType, options);
  }
}

/**
 * Fetch categories from local SQLite database
 */
async function fetchCategoriesFromLocalDatabase(
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
): Promise<Category[]> {
  // Fall back to local SQLite database
  if (isElectron) {
    try {
      // Get all products first - we need to filter by category1_name to match API logic
      const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
      if (!electronAPI?.localDbGetAllProducts) {
        return [];
      }
      const allProductsResult = await (electronAPI.localDbGetAllProducts as () => Promise<unknown[]>)();
      let allProducts: UnknownRecord[] = Array.isArray(allProductsResult) ? allProductsResult as UnknownRecord[] : [];

      // Normalize local rows to API shape: ensure category1_name and category2_name exist
      allProducts = allProducts.map((p: UnknownRecord) => ({
        ...p,
        category1_name: p.category1_name ?? p.kategori ?? null, // SQLite uses 'kategori' for category1
        category2_name: p.category2_name ?? p.jenis ?? null,
      }));

      // Filter products by transaction type using category1_name (matching API logic)
      let filteredProducts = allProducts;
      if (transactionType) {
        if (transactionType === 'bakery') {
          filteredProducts = allProducts.filter((p: UnknownRecord) => p.category1_name === 'Bakery');
        } else if (transactionType === 'drinks') {
          // For drinks, include products where category1_name is 'Minuman' or 'Dessert'
          filteredProducts = allProducts.filter((p: UnknownRecord) =>
            p.category1_name && (p.category1_name === 'Minuman' || p.category1_name === 'Dessert')
          );
        }
      }

      // Get distinct category2 names from filtered products (matching API logic)
      const category2Set = new Set<string>();
      filteredProducts.forEach((p: UnknownRecord) => {
        const category2Name = typeof p.category2_name === 'string' ? p.category2_name : null;
        if (category2Name && category2Name.trim() !== '') {
          category2Set.add(category2Name);
        }
      });

      // Convert to array of category objects
      let filteredCategories = Array.from(category2Set).map((catName: string) => ({
        category2_name: catName
      }));

      // Apply online/platform filter if needed - use filteredProducts (already filtered by transaction type)
      if (options?.isOnline && options?.platform) {
        // Only show categories that have products with the platform price (within filtered products)
        const productsWithPlatformPrice = filteredProducts.filter((p: UnknownRecord) => {
          if (options.platform === 'qpon') return p.harga_qpon && Number(p.harga_qpon) > 0;
          if (options.platform === 'gofood') return p.harga_gofood && Number(p.harga_gofood) > 0;
          if (options.platform === 'grabfood') return p.harga_grabfood && Number(p.harga_grabfood) > 0;
          if (options.platform === 'shopeefood') return p.harga_shopeefood && Number(p.harga_shopeefood) > 0;
          if (options.platform === 'tiktok') return p.harga_tiktok && Number(p.harga_tiktok) > 0;
          return false;
        });

        const category2SetWithPrice = new Set<string>();
        productsWithPlatformPrice.forEach((p: UnknownRecord) => {
          if (p.category2_name && String(p.category2_name).trim() !== '') {
            category2SetWithPrice.add(String(p.category2_name));
          }
        });

        filteredCategories = filteredCategories.filter((cat: { category2_name: string }) =>
          category2SetWithPrice.has(cat.category2_name)
        );
      }
      // Note: If online=true but no platform specified, show all categories (no harga_online filter)

      // Transform to match expected format
      const formattedCategories = filteredCategories.map((cat: { category2_name: string }, index: number) => ({
        jenis: cat.category2_name,
        active: index === 0,
      }));

      // console.log('✅ Loaded categories from local database:', formattedCategories.length);
      return formattedCategories;
    } catch (localError) {
      console.error('❌ Failed to load from local database:', localError);
    }
  }

  // If everything fails, return empty array
  return [];
}

/**
 * Check if running in Electron with offline support
 */
export function hasOfflineSupport(): boolean {
  return Boolean(isElectron);
}



