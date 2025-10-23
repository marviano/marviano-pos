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
  try {
    // Try online fetch first
    let url = category2Name ? `/api/products?category2_name=${encodeURIComponent(category2Name)}` : '/api/products';
    if (transactionType) {
      url += (url.includes('?') ? '&' : '?') + `transaction_type=${transactionType}`;
    }
    if (options?.isOnline) {
      url += (url.includes('?') ? '&' : '?') + `online=true`;
    }
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error('Network request failed');
    }
    
    const data = await response.json();
    
    if (data.success && data.products) {
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
    
    throw new Error('Invalid response format');
  } catch (error) {
    // If forceOnline is true, don't fall back to offline data
    if (options?.forceOnline) {
      console.warn('⚠️ Force online mode enabled, but online fetch failed:', error);
      return [];
    }
    
    console.warn('⚠️ Online fetch failed, using offline data:', error);
    
    // Fall back to local SQLite database
    if (isElectron) {
      try {
        let products;
        if (category2Name) {
          products = await (window as any).electronAPI.localDbGetProductsByCategory2(category2Name);
        } else {
          products = await (window as any).electronAPI.localDbGetAllProducts();
        }
        
        // Filter by transaction type if specified using category2_name
        if (transactionType) {
          if (transactionType === 'drinks') {
            products = products.filter((p: Product) => 
              p.category2_name && ['Ice Cream Cone', 'Sundae', 'Milk Tea'].includes(p.category2_name)
            );
          } else if (transactionType === 'bakery') {
            products = products.filter((p: Product) => p.category2_name === 'Bakery');
          }
        }

        // Apply online-only filter when needed
        if (options?.isOnline) {
          products = products.filter((p: Product) => !!p.harga_online && p.harga_online > 0);
        }
        
        console.log('✅ Loaded products from local database:', products.length);
        return products;
      } catch (localError) {
        console.error('❌ Failed to load from local database:', localError);
      }
    }
    
    // If everything fails, return empty array
    return [];
  }
}

/**
 * Fetch categories with offline fallback
 */
export async function fetchCategories(
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean }
): Promise<Category[]> {
  try {
    // Try online fetch first
    let url = '/api/categories';
    if (transactionType) {
      url += `?transaction_type=${transactionType}`;
    }
    if (options?.isOnline) {
      url += (url.includes('?') ? '&' : '?') + `online=true`;
    }
    const response = await fetch(url, { cache: 'no-store' });
    
    if (!response.ok) {
      throw new Error('Network request failed');
    }
    
    const data = await response.json();
    
    if (data.success && data.categories) {
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
    
    throw new Error('Invalid response format');
  } catch (error) {
    console.warn('⚠️ Online fetch failed, using offline data:', error);
    
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
}

/**
 * Check if running in Electron with offline support
 */
export function hasOfflineSupport(): boolean {
  return isElectron;
}


