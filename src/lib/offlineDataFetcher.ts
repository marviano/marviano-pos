/**
 * Data Fetcher with Offline Support
 * Automatically falls back to local SQLite database when offline
 */

const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

interface Product {
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
  harga_online: number | null;
  fee_kerja: number | null;
  image_url: string | null;
  status: 'active' | 'inactive';
}

interface Category {
  jenis: string;
  active?: boolean;
}

/**
 * Fetch products with offline fallback
 */
export async function fetchProducts(
  category2Name?: string,
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, forceOnline?: boolean }
): Promise<Product[]> {
  console.log('🔍 [FETCH PRODUCTS] Starting fetch with params:', {
    category2Name,
    transactionType,
    options,
    isElectron: isElectron
  });

  // If we're in offline mode (isOnline is false), skip API call entirely
  if (options?.isOnline === false) {
    console.log('📱 [OFFLINE MODE] Skipping API call, using local database directly');
    return await fetchFromLocalDatabase(category2Name, transactionType, options);
  }

  try {
    // Try online fetch first
    let url = category2Name ? `/api/products?category2_name=${encodeURIComponent(category2Name)}` : '/api/products';
    if (transactionType) {
      url += (url.includes('?') ? '&' : '?') + `transaction_type=${transactionType}`;
    }
    if (options?.isOnline) {
      url += (url.includes('?') ? '&' : '?') + `online=true`;
    }
    
    console.log('🌐 [ONLINE FETCH] Making API request to:', url);
    const response = await fetch(url, { cache: 'no-store' });
    
    console.log('🌐 [ONLINE FETCH] Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      throw new Error(`Network request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('🌐 [ONLINE FETCH] Response data:', data);
    
    if (data.success && data.products) {
      console.log('✅ [ONLINE FETCH] Successfully fetched', data.products.length, 'products');
      
      // If we got online data successfully, cache it locally
      if (isElectron) {
        try {
          await (window as any).electronAPI.localDbUpsertProducts(data.products);
          console.log('✅ Products cached locally');
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
      console.warn('⚠️ Force online mode enabled, but online fetch failed:', error);
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
  options?: { isOnline?: boolean, forceOnline?: boolean }
): Promise<Product[]> {
    // Fall back to local SQLite database
    if (isElectron) {
      try {
        console.log('🔄 [OFFLINE FETCHER] Falling back to local SQLite database');
        let products;
        if (category2Name) {
          console.log('🔄 [OFFLINE FETCHER] Fetching products by category2:', category2Name);
          products = await (window as any).electronAPI.localDbGetProductsByCategory2(category2Name);
        } else {
          console.log('🔄 [OFFLINE FETCHER] Fetching all products');
          products = await (window as any).electronAPI.localDbGetAllProducts();
        }
        
        console.log('📦 [OFFLINE FETCHER] Retrieved products from SQLite:', products ? products.length : 0);
        
        // Filter by transaction type if specified using category2_name
        if (transactionType) {
          console.log('🔄 [OFFLINE FETCHER] Filtering by transaction type:', transactionType);
        console.log('🔄 [OFFLINE FETCHER] Products before filtering:', products.map(p => ({ id: p.id, name: p.nama, category2: p.category2_name })));
        
        // TEMPORARY FIX: Show all products when offline to debug the issue
        if (options?.isOnline === false) {
          console.log('🔧 [DEBUG] Offline mode detected - showing ALL products for debugging');
          console.log('📦 [OFFLINE FETCHER] After filtering (DEBUG):', products.length, 'products');
          console.log('📦 [OFFLINE FETCHER] All products:', products.map(p => ({ id: p.id, name: p.nama, category2: p.category2_name })));
        } else {
          if (transactionType === 'drinks') {
            products = products.filter((p: Product) => 
              p.category2_name && ['Ice Cream Cone', 'Sundae', 'Milk Tea'].includes(p.category2_name)
            );
          } else if (transactionType === 'bakery') {
            products = products.filter((p: Product) => p.category2_name === 'Bakery');
          }
          console.log('📦 [OFFLINE FETCHER] After filtering:', products.length, 'products');
          console.log('📦 [OFFLINE FETCHER] Filtered products:', products.map(p => ({ id: p.id, name: p.nama, category2: p.category2_name })));
        }
        }

        // Apply online-only filter when needed
        if (options?.isOnline) {
          console.log('🔄 [OFFLINE FETCHER] Applying online-only filter');
          products = products.filter((p: Product) => !!p.harga_online && p.harga_online > 0);
          console.log('📦 [OFFLINE FETCHER] After online filter:', products.length, 'products');
        }
        
        console.log('✅ [OFFLINE FETCHER] Returning', products.length, 'products from offline database');
        return products;
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
  options?: { isOnline?: boolean }
): Promise<Category[]> {
  console.log('🔍 [FETCH CATEGORIES] Starting fetch with params:', {
    transactionType,
    options,
    isElectron: isElectron
  });

  // If we're in offline mode (isOnline is false), skip API call entirely
  if (options?.isOnline === false) {
    console.log('📱 [OFFLINE MODE] Skipping API call for categories, using local database directly');
    return await fetchCategoriesFromLocalDatabase(transactionType, options);
  }

  try {
    // Try online fetch first
    let url = '/api/categories';
    if (transactionType) {
      url += `?transaction_type=${transactionType}`;
    }
    if (options?.isOnline) {
      url += (url.includes('?') ? '&' : '?') + `online=true`;
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
          await (window as any).electronAPI.localDbUpsertCategories(
            data.categories.map((cat: Category) => ({
              jenis: cat.jenis,
              updated_at: Date.now(),
            }))
          );
          console.log('✅ Categories cached locally');
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
  options?: { isOnline?: boolean }
): Promise<Category[]> {
    // Fall back to local SQLite database
    if (isElectron) {
      try {
        const categories = await (window as any).electronAPI.localDbGetCategories();
        
        // Filter by transaction type if specified
        let filteredCategories = categories;
        if (transactionType) {
          if (transactionType === 'drinks') {
            filteredCategories = categories.filter((cat: any) => 
              ['Ice Cream Cone', 'Sundae', 'Milk Tea'].includes(cat.jenis)
            );
          } else if (transactionType === 'bakery') {
            filteredCategories = categories.filter((cat: any) => cat.jenis === 'Bakery');
          }
        }

        // Apply online filter if needed
        if (options?.isOnline) {
          // This would need to be implemented based on your local database structure
          // For now, we'll return all categories that match the transaction type
        }
        
        // Transform to match expected format
        const formattedCategories = filteredCategories.map((cat: any, index: number) => ({
          jenis: cat.jenis,
          active: index === 0,
        }));
        
        console.log('✅ Loaded categories from local database:', formattedCategories.length);
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
  return isElectron;
}


