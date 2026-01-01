/**
 * Data Fetcher - MySQL via Electron IPC
 * Fetches data from MySQL database via Electron IPC handlers (direct MySQL connection)
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
 * Fetch products from MySQL database via Electron IPC (direct MySQL connection)
 */
export async function fetchProducts(
  category2Name?: string,
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, forceOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Product[]> {
  // Use Electron MySQL connection (direct MySQL queries via IPC)
  if (isElectron) {
    return await fetchProductsFromMySQL(category2Name, transactionType, options);
  }

  // Fallback to API if not in Electron (web mode)
  try {
    let url = category2Name 
      ? getApiUrl(`/api/products?category2_name=${encodeURIComponent(category2Name)}`) 
      : getApiUrl('/api/products');
    
    if (options?.businessId) url += (url.includes('?') ? '&' : '?') + `businessId=${options.businessId}`;
    if (transactionType) url += (url.includes('?') ? '&' : '?') + `transaction_type=${transactionType}`;
    if (options?.isOnline) url += (url.includes('?') ? '&' : '?') + `online=true`;
    if (options?.platform) url += (url.includes('?') ? '&' : '?') + `platform=${options.platform}`;

    const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    return data.success && data.products ? data.products : [];
  } catch (error) {
    console.error('❌ [FETCH PRODUCTS] Error:', error);
    return [];
  }
}

/**
 * Fetch products from MySQL via Electron IPC handlers (direct MySQL connection)
 */
async function fetchProductsFromMySQL(
  category2Name?: string,
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Product[]> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:78',message:'fetchProductsFromMySQL called',data:{category2Name,transactionType,businessId:options?.businessId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:85',message:'Electron API check',data:{isElectron:!!electronAPI,hasLocalDbGetProductsByCategory2:!!electronAPI?.localDbGetProductsByCategory2,hasLocalDbGetAllProducts:!!electronAPI?.localDbGetAllProducts},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!electronAPI) {
      console.warn('⚠️ [FETCH PRODUCTS] Electron API not available');
      return [];
    }

    let products: UnknownRecord[] = [];
    const businessId = options?.businessId;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:93',message:'Before MySQL query',data:{category2Name,businessId,willUseCategory2Query:!!(category2Name&&electronAPI.localDbGetProductsByCategory2)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,C'})}).catch(()=>{});
    // #endregion
    // Fetch products by category2_name or all products
    if (category2Name && electronAPI.localDbGetProductsByCategory2) {
      const result = await (electronAPI.localDbGetProductsByCategory2 as (category2Name: string, businessId?: number) => Promise<unknown[]>)(category2Name, businessId);
      products = Array.isArray(result) ? result as UnknownRecord[] : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:97',message:'After category2 query',data:{productCount:products.length,firstProduct:products[0]||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D'})}).catch(()=>{});
      // #endregion
    } else if (electronAPI.localDbGetAllProducts) {
      const result = await (electronAPI.localDbGetAllProducts as (businessId?: number) => Promise<unknown[]>)(businessId);
      products = Array.isArray(result) ? result as UnknownRecord[] : [];
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:101',message:'After all products query',data:{productCount:products.length,firstProduct:products[0]||null,sampleCategory1Name:products[0]?.category1_name||null,sampleCategory2Name:products[0]?.category2_name||null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,D,E'})}).catch(()=>{});
      // #endregion
    } else {
      console.warn('⚠️ [FETCH PRODUCTS] MySQL query methods not available');
      return [];
    }

    // Filter by transaction type using category1_name
    if (transactionType) {
      const beforeCount = products.length;
      if (transactionType === 'drinks') {
        products = products.filter((p: UnknownRecord) => {
          const category1Name = p.category1_name;
          return category1Name && (category1Name === 'Minuman' || category1Name === 'Dessert');
        });
      } else if (transactionType === 'bakery') {
        products = products.filter((p: UnknownRecord) => p.category1_name === 'Bakery');
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:110',message:'After transaction type filter',data:{transactionType,beforeCount,afterCount:products.length,uniqueCategory1Names:[...new Set(products.map((p:UnknownRecord)=>p.category1_name).filter(Boolean))]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
    }

    // Filter by platform if in online mode
    if (options?.isOnline && options?.platform) {
      // BUG PROOF: Track products with price = 0 that pass this filter (>= 0)
      const productsWithZeroPrice: Array<{ id: any; nama: any; category2_name: any; harga_xxx: any }> = [];
      products = products.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        let passes = false;
        let priceValue: any = null;
        if (options.platform === 'qpon') {
          passes = product.harga_qpon != null && product.harga_qpon >= 0;
          priceValue = product.harga_qpon;
        } else if (options.platform === 'gofood') {
          passes = product.harga_gofood != null && product.harga_gofood >= 0;
          priceValue = product.harga_gofood;
        } else if (options.platform === 'grabfood') {
          passes = product.harga_grabfood != null && product.harga_grabfood >= 0;
          priceValue = product.harga_grabfood;
        } else if (options.platform === 'shopeefood') {
          passes = product.harga_shopeefood != null && product.harga_shopeefood >= 0;
          priceValue = product.harga_shopeefood;
        } else if (options.platform === 'tiktok') {
          passes = product.harga_tiktok != null && product.harga_tiktok >= 0;
          priceValue = product.harga_tiktok;
        }
        // BUG PROOF: Log products with price = 0 that pass the filter
        if (passes && priceValue === 0) {
          productsWithZeroPrice.push({
            id: product.id,
            nama: product.nama,
            category2_name: product.category2_name,
            harga_xxx: priceValue
          });
        }
        return passes;
      });
      // BUG PROOF: Log products with zero price that passed product filter
      if (productsWithZeroPrice.length > 0) {
        console.log(`🐛 [BUG PROOF #1] Products with ${options.platform} price = 0 that PASSED product filter (>= 0):`, productsWithZeroPrice);
        console.log(`🐛 [BUG PROOF #1] These products will appear in product list but may be excluded from categories`);
      }
    }

    console.log(`✅ [FETCH PRODUCTS] Fetched ${products.length} products from MySQL`);
    return products as unknown as Product[];
  } catch (error) {
    console.error('❌ [FETCH PRODUCTS] MySQL query error:', error);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:136',message:'fetchProductsFromMySQL error',data:{error:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    return [];
  }
}

/**
 * Fetch categories from MySQL database via Electron IPC (direct MySQL connection)
 */
export async function fetchCategories(
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Category[]> {
  // Use Electron MySQL connection (direct MySQL queries via IPC)
  if (isElectron) {
    return await fetchCategoriesFromMySQL(transactionType, options);
  }

  // Fallback to API if not in Electron (web mode)
  try {
    let url = getApiUrl('/api/categories');
    const params = new URLSearchParams();
    if (options?.businessId) params.append('businessId', String(options.businessId));
    if (transactionType) params.append('transaction_type', transactionType);
    if (options?.isOnline) params.append('online', 'true');
    if (options?.platform) params.append('platform', options.platform);
    if (params.toString()) url += '?' + params.toString();

    const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    return data.success && data.categories ? data.categories : [];
  } catch (error) {
    console.error('❌ [FETCH CATEGORIES] Error:', error);
    return [];
  }
}

/**
 * Fetch categories from MySQL via Electron IPC handlers (direct MySQL connection)
 * Categories are derived from products (category2 names from active products)
 */
async function fetchCategoriesFromMySQL(
  transactionType?: 'drinks' | 'bakery',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Category[]> {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:175',message:'fetchCategoriesFromMySQL called',data:{transactionType,businessId:options?.businessId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:181',message:'Electron API check for categories',data:{isElectron:!!electronAPI,hasLocalDbGetAllProducts:!!electronAPI?.localDbGetAllProducts},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!electronAPI?.localDbGetAllProducts) {
      console.warn('⚠️ [FETCH CATEGORIES] MySQL query method not available');
      return [];
    }

    const businessId = options?.businessId;
    const allProductsResult = await (electronAPI.localDbGetAllProducts as (businessId?: number) => Promise<unknown[]>)(businessId);
    let allProducts: UnknownRecord[] = Array.isArray(allProductsResult) ? allProductsResult as UnknownRecord[] : [];
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:189',message:'After MySQL products query for categories',data:{productCount:allProducts.length,sampleCategory1Names:[...new Set(allProducts.slice(0,10).map((p:UnknownRecord)=>p.category1_name).filter(Boolean))],sampleCategory2Names:[...new Set(allProducts.slice(0,10).map((p:UnknownRecord)=>p.category2_name).filter(Boolean))]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B,C,D'})}).catch(()=>{});
    // #endregion

    // Filter products by transaction type using category1_name
    let filteredProducts = allProducts;
    if (transactionType) {
      if (transactionType === 'bakery') {
        filteredProducts = allProducts.filter((p: UnknownRecord) => p.category1_name === 'Bakery');
      } else if (transactionType === 'drinks') {
        filteredProducts = allProducts.filter((p: UnknownRecord) =>
          p.category1_name && (p.category1_name === 'Minuman' || p.category1_name === 'Dessert')
        );
      }
    }

    // Filter by harga_jual in offline mode (exclude NULL, undefined, or 0)
    // This matches the filtering logic in CenterContent.tsx
    if (!options?.isOnline) {
      const beforeCount = filteredProducts.length;
      filteredProducts = filteredProducts.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        const hargaJual = product.harga_jual;
        // Filter out NULL, undefined, or 0 (0 is used as fallback for products that only have platform prices)
        if (hargaJual === null || hargaJual === undefined || hargaJual === 0) {
          return false;
        }
        return true;
      });
      console.log(`🔍 [FETCH CATEGORIES] Filtered ${beforeCount - filteredProducts.length} products with invalid harga_jual (NULL/0) in offline mode, ${filteredProducts.length} remaining`);
    }

    // Get distinct category2 names from filtered products
    const category2Set = new Set<string>();
    filteredProducts.forEach((p: UnknownRecord) => {
      const category2Name = typeof p.category2_name === 'string' ? p.category2_name : null;
      if (category2Name && category2Name.trim() !== '') {
        category2Set.add(category2Name);
      }
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:209',message:'After extracting category2 names',data:{filteredProductCount:filteredProducts.length,category2Count:category2Set.size,category2Names:Array.from(category2Set)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D,E'})}).catch(()=>{});
    // #endregion

    // Apply platform filter if needed
    if (options?.isOnline && options?.platform) {
      // DEBUG: Check KOC products BEFORE platform filtering
      if (options.platform === 'tiktok') {
        const kocProductsBeforeFilter = filteredProducts.filter((p: UnknownRecord) => p.category2_name === 'KOC');
        console.log(`🐛 [CATEGORY FILTER DEBUG] KOC products BEFORE platform filter:`, {
          kocCount: kocProductsBeforeFilter.length,
          kocProducts: kocProductsBeforeFilter.map((p: UnknownRecord) => {
            const product = p as unknown as Product;
            return {
              id: p.id,
              nama: p.nama,
              category1_name: p.category1_name,
              category2_name: p.category2_name,
              harga_tiktok: product.harga_tiktok,
              harga_tiktok_type: typeof product.harga_tiktok,
              harga_tiktok_isNull: product.harga_tiktok === null,
              harga_tiktok_isUndefined: product.harga_tiktok === undefined,
              harga_tiktok_isZero: product.harga_tiktok === 0,
              willPassFilter: product.harga_tiktok != null && product.harga_tiktok >= 0
            };
          })
        });
        // More explicit log for each KOC product
        if (kocProductsBeforeFilter.length > 0) {
          console.log(`🐛 [CATEGORY FILTER DEBUG] 📋 KOC Products Detail (${kocProductsBeforeFilter.length} total):`);
          kocProductsBeforeFilter.forEach((p: UnknownRecord, idx: number) => {
            const product = p as unknown as Product;
            const hargaTiktok = product.harga_tiktok;
            const passes = hargaTiktok != null && hargaTiktok >= 0;
            console.log(`  [${idx + 1}] ID: ${p.id}, Name: "${p.nama}", harga_tiktok: ${hargaTiktok} (type: ${typeof hargaTiktok}, null: ${hargaTiktok === null}, undefined: ${hargaTiktok === undefined}, zero: ${hargaTiktok === 0}), WILL PASS: ${passes}`);
          });
        } else {
          console.log(`🐛 [CATEGORY FILTER DEBUG] ⚠️ No KOC products found in filteredProducts (before platform filter)`);
        }
      }

      // FIX: Use same filter logic as product filtering (>= 0) to be consistent
      const productsWithPlatformPrice = filteredProducts.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        let passes = false;
        if (options.platform === 'qpon') passes = product.harga_qpon != null && product.harga_qpon >= 0;
        else if (options.platform === 'gofood') passes = product.harga_gofood != null && product.harga_gofood >= 0;
        else if (options.platform === 'grabfood') passes = product.harga_grabfood != null && product.harga_grabfood >= 0;
        else if (options.platform === 'shopeefood') passes = product.harga_shopeefood != null && product.harga_shopeefood >= 0;
        else if (options.platform === 'tiktok') passes = product.harga_tiktok != null && product.harga_tiktok >= 0;
        return passes;
      });

      // DEBUG: Log products with platform price >= 0 for category building
      if (options.platform === 'tiktok') {
        const tiktokProducts = productsWithPlatformPrice.filter((p: UnknownRecord) => {
          const product = p as unknown as Product;
          return product.harga_tiktok != null && product.harga_tiktok >= 0;
        });
        console.log(`🐛 [CATEGORY FILTER DEBUG] Products with harga_tiktok >= 0 for category building:`, {
          totalFilteredProducts: filteredProducts.length,
          productsWithTiktokPrice: tiktokProducts.length,
          products: tiktokProducts.slice(0, 20).map((p: UnknownRecord) => {
            const product = p as unknown as Product;
            return {
              id: p.id,
              nama: p.nama,
              category2_name: p.category2_name,
              harga_tiktok: product.harga_tiktok,
              harga_jual: product.harga_jual
            };
          })
        });
        const kocProducts = tiktokProducts.filter((p: UnknownRecord) => p.category2_name === 'KOC');
        if (kocProducts.length > 0) {
          console.log(`🐛 [CATEGORY FILTER DEBUG] KOC products with harga_tiktok >= 0:`, kocProducts.map((p: UnknownRecord) => {
            const product = p as unknown as Product;
            return {
              id: p.id,
              nama: p.nama,
              harga_tiktok: product.harga_tiktok,
              harga_jual: product.harga_jual
            };
          }));
          // More explicit log for KOC products that passed
          console.log(`🐛 [CATEGORY FILTER DEBUG] ✅ KOC Products AFTER platform filter (${kocProducts.length} passed):`);
          kocProducts.forEach((p: UnknownRecord, idx: number) => {
            const product = p as unknown as Product;
            console.log(`  [${idx + 1}] ID: ${p.id}, Name: "${p.nama}", harga_tiktok: ${product.harga_tiktok}`);
          });
        } else {
          console.log(`🐛 [CATEGORY FILTER DEBUG] ⚠️ No KOC products found with harga_tiktok >= 0`);
          // Show why they didn't pass - check original KOC products
          const originalKocProducts = filteredProducts.filter((p: UnknownRecord) => p.category2_name === 'KOC');
          if (originalKocProducts.length > 0) {
            console.log(`🐛 [CATEGORY FILTER DEBUG] 🔍 Why KOC products didn't pass filter:`);
            originalKocProducts.forEach((p: UnknownRecord, idx: number) => {
              const product = p as unknown as Product;
              const hargaTiktok = product.harga_tiktok;
              const passes = hargaTiktok != null && hargaTiktok >= 0;
              console.log(`  [${idx + 1}] ID: ${p.id}, Name: "${p.nama}", harga_tiktok: ${hargaTiktok} (${typeof hargaTiktok}), PASSES: ${passes}`);
            });
          }
        }
      }

      const category2SetWithPrice = new Set<string>();
      productsWithPlatformPrice.forEach((p: UnknownRecord) => {
        if (p.category2_name && String(p.category2_name).trim() !== '') {
          category2SetWithPrice.add(String(p.category2_name));
        }
      });

      // DEBUG: Log categories that will be included
      if (options.platform === 'tiktok') {
        console.log(`🐛 [CATEGORY FILTER DEBUG] Categories from products with harga_tiktok >= 0:`, {
          categoriesFromProducts: Array.from(category2SetWithPrice),
          originalCategories: Array.from(category2Set),
          kocIncluded: category2SetWithPrice.has('KOC')
        });
      }

      // Filter categories to only those with platform prices
      const filteredSet = new Set<string>();
      category2Set.forEach(cat => {
        if (category2SetWithPrice.has(cat)) {
          filteredSet.add(cat);
        }
      });
      category2Set.clear();
      filteredSet.forEach(cat => category2Set.add(cat));

      // DEBUG: Log final categories
      if (options.platform === 'tiktok') {
        console.log(`🐛 [CATEGORY FILTER DEBUG] Final categories after filtering:`, {
          finalCategories: Array.from(category2Set),
          kocIncluded: category2Set.has('KOC')
        });
      }
    }

    // Convert to category format
    const categories = Array.from(category2Set).map((catName: string, index: number) => ({
      jenis: catName,
      active: index === 0
    }));

    console.log(`✅ [FETCH CATEGORIES] Fetched ${categories.length} categories from MySQL`);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:249',message:'fetchCategoriesFromMySQL returning',data:{finalCategoryCount:categories.length,categories:categories.map(c=>c.jenis)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return categories;
  } catch (error) {
    console.error('❌ [FETCH CATEGORIES] MySQL query error:', error);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ab3104c9-1432-4522-ad92-f25b532b192c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:252',message:'fetchCategoriesFromMySQL error',data:{error:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    return [];
  }
}



