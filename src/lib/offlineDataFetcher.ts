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
  harga_gofood: number | null;
  harga_grabfood: number | null;
  harga_shopeefood: number | null;
  harga_tiktok: number | null;
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
  options?: { isOnline?: boolean, forceOnline?: boolean, platform?: 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
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
    if (options?.platform) {
      url += (url.includes('?') ? '&' : '?') + `platform=${options.platform}`;
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
  options?: { isOnline?: boolean, forceOnline?: boolean, platform?: 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
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

        // Normalize local rows to API shape: ensure category1_name and category2_name exist
        products = (products || []).map((p: any) => ({
          ...p,
          category1_name: p.category1_name ?? p.kategori ?? null, // SQLite uses 'kategori' for category1
          category2_name: p.category2_name ?? p.jenis ?? null,
        }));
        
        // Log first product to see its structure
        if (products.length > 0) {
          console.log('🔍 [DEBUG] First product structure:', products[0]);
          console.log('🔍 [DEBUG] First product keys:', Object.keys(products[0]));
        }

        // When no specific category is selected, only show products with valid category2_name
        // This ensures consistency with categories API (which only shows categories with non-null names)
        if (!category2Name) {
          products = products.filter((p: Product) => p.category2_name && p.category2_name.trim() !== '');
        }

        // Filter by transaction type if specified - using category1_name to match API logic
        if (transactionType) {
          console.log('🔄 [OFFLINE FETCHER] Filtering by transaction type:', transactionType);
          console.log('🔄 [OFFLINE FETCHER] Products before filtering:', products.map(p => ({ 
            id: p.id, 
            name: p.nama, 
            category1_name: p.category1_name,
            category2_name: p.category2_name
          })));
          
          // Filter by transaction type: bakery vs drinks - match API logic using category1_name
          if (transactionType === 'drinks') {
            products = products.filter((p: Product) => 
              p.category1_name && (p.category1_name === 'Minuman' || p.category1_name === 'Dessert')
            );
          } else if (transactionType === 'bakery') {
            products = products.filter((p: Product) => p.category1_name === 'Bakery');
          }
          console.log('📦 [OFFLINE FETCHER] After filtering:', products.length, 'products');
          console.log('📦 [OFFLINE FETCHER] Filtered products:', products.map(p => ({ 
            id: p.id, 
            name: p.nama, 
            category1_name: p.category1_name,
            category2_name: p.category2_name
          })));
        }

        // Apply online/platform filter when in online mode (offline DB)
        if (options?.isOnline && options?.platform) {
          console.log('🔄 [OFFLINE FETCHER] Applying platform filter for', options.platform);
          products = products.filter((p: Product) => {
            if (options.platform === 'gofood') return !!p.harga_gofood && p.harga_gofood > 0;
            if (options.platform === 'grabfood') return !!p.harga_grabfood && p.harga_grabfood > 0;
            if (options.platform === 'shopeefood') return !!p.harga_shopeefood && p.harga_shopeefood > 0;
            if (options.platform === 'tiktok') return !!p.harga_tiktok && p.harga_tiktok > 0;
            return false;
          });
          console.log('📦 [OFFLINE FETCHER] After platform filter:', products.length, 'products');
        }
        // Note: If online=true but no platform specified, show all products (no harga_online filter)
        
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
  options?: { isOnline?: boolean, platform?: 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
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
    if (options?.platform) {
      url += (url.includes('?') ? '&' : '?') + `platform=${options.platform}`;
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
  options?: { isOnline?: boolean, platform?: 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok' }
): Promise<Category[]> {
    // Fall back to local SQLite database
    if (isElectron) {
      try {
        // Get all products first - we need to filter by category1_name to match API logic
        let allProducts = await (window as any).electronAPI.localDbGetAllProducts();
        
        // Normalize local rows to API shape: ensure category1_name and category2_name exist
        allProducts = (allProducts || []).map((p: any) => ({
          ...p,
          category1_name: p.category1_name ?? p.kategori ?? null, // SQLite uses 'kategori' for category1
          category2_name: p.category2_name ?? p.jenis ?? null,
        }));
        
        // Filter products by transaction type using category1_name (matching API logic)
        let filteredProducts = allProducts;
        if (transactionType) {
          if (transactionType === 'bakery') {
            filteredProducts = allProducts.filter((p: any) => p.category1_name === 'Bakery');
          } else if (transactionType === 'drinks') {
            // For drinks, include products where category1_name is 'Minuman' or 'Dessert'
            filteredProducts = allProducts.filter((p: any) => 
              p.category1_name && (p.category1_name === 'Minuman' || p.category1_name === 'Dessert')
            );
          }
        }
        
        // Get distinct category2 names from filtered products (matching API logic)
        const category2Set = new Set<string>();
        filteredProducts.forEach((p: any) => {
          if (p.category2_name && p.category2_name.trim() !== '') {
            category2Set.add(p.category2_name);
          }
        });
        
        // Convert to array of category objects
        let filteredCategories = Array.from(category2Set).map((catName: string) => ({
          category2_name: catName
        }));

        // Apply online/platform filter if needed - use filteredProducts (already filtered by transaction type)
        if (options?.isOnline && options?.platform) {
          // Only show categories that have products with the platform price (within filtered products)
          const productsWithPlatformPrice = filteredProducts.filter((p: any) => {
            if (options.platform === 'gofood') return p.harga_gofood && p.harga_gofood > 0;
            if (options.platform === 'grabfood') return p.harga_grabfood && p.harga_grabfood > 0;
            if (options.platform === 'shopeefood') return p.harga_shopeefood && p.harga_shopeefood > 0;
            if (options.platform === 'tiktok') return p.harga_tiktok && p.harga_tiktok > 0;
            return false;
          });
          
          const category2SetWithPrice = new Set<string>();
          productsWithPlatformPrice.forEach((p: any) => {
            if (p.category2_name && p.category2_name.trim() !== '') {
              category2SetWithPrice.add(p.category2_name);
            }
          });
          
          filteredCategories = filteredCategories.filter((cat: any) => 
            category2SetWithPrice.has(cat.category2_name)
          );
        }
        // Note: If online=true but no platform specified, show all categories (no harga_online filter)
        
        // Transform to match expected format
        const formattedCategories = filteredCategories.map((cat: any, index: number) => ({
          jenis: cat.category2_name,
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



