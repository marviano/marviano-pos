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
  is_bundle?: number | boolean;
  is_package?: number | boolean;
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
  transactionType?: 'drinks' | 'bakery' | 'foods' | 'packages',
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
  transactionType?: 'drinks' | 'bakery' | 'foods' | 'packages',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Product[]> {
    // #region agent log
    try { fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:fetchProductsFromMySQL',message:'fetchProducts entry',data:{category2Name,transactionType,businessId:options?.businessId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3,H4'})}).catch(()=>{}); } catch (_) {}
    // #endregion
    try {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;if (!electronAPI) {
      console.warn('⚠️ [FETCH PRODUCTS] Electron API not available');
      return [];
    }

    let products: UnknownRecord[] = [];
    const businessId = options?.businessId;// Fetch products by category2_name or all products
    if (category2Name && electronAPI.localDbGetProductsByCategory2) {
      const result = await (electronAPI.localDbGetProductsByCategory2 as (category2Name: string, businessId?: number) => Promise<unknown[]>)(category2Name, businessId);
      products = Array.isArray(result) ? result as UnknownRecord[] : [];
      // #region agent log
      const isPaketBukber = (category2Name || '').includes('Paket Bukber');
      if (isPaketBukber || (transactionType === 'foods' && products.some((p: UnknownRecord) => String(p.category2_name || '').includes('Paket Bukber')))) {
        const paketAyam = products.find((p: UnknownRecord) => String(p.nama || '').toLowerCase().includes('paket ayam sedih') || String(p.menu_code || '') === 'PAKET-001');
        const sampleArr = products.slice(0, 5).map((p: UnknownRecord) => ({ nama: p.nama, c1: p.category1_name, c2: p.category2_name }));
        const payload = { location: 'offlineDataFetcher.ts:fetchProducts', message: 'raw products from DB', data: { category2Name, rawCount: products.length, paketAyamFound: !!paketAyam, paketAyamData: paketAyam ? { id: paketAyam.id, nama: paketAyam.nama, c1: paketAyam.category1_name, c2: paketAyam.category2_name } : null, sample: sampleArr }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1,H3' };
        fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
      }
      // #endregion
    } else if (electronAPI.localDbGetAllProducts) {
      const result = await (electronAPI.localDbGetAllProducts as (businessId?: number) => Promise<unknown[]>)(businessId);
      products = Array.isArray(result) ? result as UnknownRecord[] : [];} else {
      console.warn('⚠️ [FETCH PRODUCTS] MySQL query methods not available');
      return [];
    }

    // Filter by transaction type using category1_name or category1_id
    if (transactionType) {
      const beforeCount = products.length;
      const paketAyamInRaw = products.find((p: UnknownRecord) => String(p.nama || '').toLowerCase().includes('paket ayam sedih') || String(p.menu_code || '') === 'PAKET-001');
      if (transactionType === 'drinks') {
        products = products.filter((p: UnknownRecord) => {
          const category1Name = p.category1_name;
          return category1Name && (category1Name === 'Minuman' || category1Name === 'Dessert');
        });
      } else if (transactionType === 'bakery') {
        products = products.filter((p: UnknownRecord) => p.category1_name === 'Bakery');
      } else if (transactionType === 'foods') {
        products = products.filter((p: UnknownRecord) => p.category1_name === 'Makanan');
      } else if (transactionType === 'packages') {
        products = products.filter((p: UnknownRecord) =>
          String(p.category1_name || '').toUpperCase() === 'PAKET' || p.category1_id === 14
        );
      }
      // #region agent log
      const hadPaketBukber = (category2Name || '').includes('Paket Bukber') || (beforeCount > 0 && products.some((p: UnknownRecord) => String(p.category2_name || '').includes('Paket Bukber')));
      if (hadPaketBukber || paketAyamInRaw) {
        const paketAyamAfter = products.find((p: UnknownRecord) => String(p.nama || '').toLowerCase().includes('paket ayam sedih'));
        fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:fetchProducts',message:'after transactionType filter',data:{category2Name,transactionType,beforeCount,afterCount:products.length,paketAyamInRaw:!!paketAyamInRaw,paketAyamC1:paketAyamInRaw?paketAyamInRaw.category1_name:null,paketAyamInResult:!!paketAyamAfter},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3,H5'})}).catch(()=>{});
      }
      // #endregion
    }

    // Filter by platform if in online mode
    if (options?.isOnline && options?.platform) {
      // BUG PROOF: Track products with price = 0 that pass this filter (>= 0)
      const productsWithZeroPrice: Array<{ id: number | string | null; nama: string | null; category2_name: string | null; harga_xxx: number | null }> = [];
      products = products.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        let passes = false;
        let priceValue: number | null = null;
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

    return products as unknown as Product[];
  } catch (error) {
    console.error('❌ [FETCH PRODUCTS] MySQL query error:', error);return [];
  }
}

/**
 * Fetch categories from MySQL database via Electron IPC (direct MySQL connection)
 */
export async function fetchCategories(
  transactionType?: 'drinks' | 'bakery' | 'foods' | 'packages',
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
  transactionType?: 'drinks' | 'bakery' | 'foods' | 'packages',
  options?: { isOnline?: boolean, platform?: 'qpon' | 'gofood' | 'grabfood' | 'shopeefood' | 'tiktok', businessId?: number }
): Promise<Category[]> {
    // #region agent log
    try { fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:fetchCategoriesFromMySQL',message:'fetchCategories entry',data:{transactionType,businessId:options?.businessId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2,H4'})}).catch(()=>{}); } catch (_) {}
    // #endregion
    try {
    const electronAPI = typeof window !== 'undefined' ? (window as { electronAPI?: UnknownRecord }).electronAPI : undefined;if (!electronAPI?.localDbGetAllProducts) {
      console.warn('⚠️ [FETCH CATEGORIES] MySQL query method not available');
      return [];
    }

    const businessId = options?.businessId;
    const allProductsResult = await (electronAPI.localDbGetAllProducts as (businessId?: number) => Promise<unknown[]>)(businessId);
    const allProducts: UnknownRecord[] = Array.isArray(allProductsResult) ? allProductsResult as UnknownRecord[] : [];
    // #region agent log
    const paketAyam = allProducts.find((p: UnknownRecord) => (String(p.nama || '').toLowerCase().includes('paket ayam sedih') || String(p.menu_code || '') === 'PAKET-001'));
    const paketBukberProducts = allProducts.filter((p: UnknownRecord) => String(p.category2_name || '').includes('Paket Bukber'));
    const sampleArr2 = paketBukberProducts.slice(0, 3).map((p: UnknownRecord) => ({ id: p.id, nama: p.nama, c1: p.category1_name, c2: p.category2_name, hj: p.harga_jual }));
    const payload1 = { location: 'offlineDataFetcher.ts:fetchCategories', message: 'allProducts loaded', data: { allProductsCount: allProducts.length, transactionType, businessId, paketAyamSedihFound: !!paketAyam, paketAyamData: paketAyam ? { id: paketAyam.id, nama: paketAyam.nama, menu_code: paketAyam.menu_code, category1_name: paketAyam.category1_name, category2_name: paketAyam.category2_name, harga_jual: paketAyam.harga_jual } : null, paketBukberCount: paketBukberProducts.length, paketBukberSample: sampleArr2 }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1,H2,H5' };
    fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload1) }).catch(() => {});
    // #endregion
    // Filter products by transaction type using category1_name or category1_id
    let filteredProducts = allProducts;
    if (transactionType) {
      if (transactionType === 'bakery') {
        filteredProducts = allProducts.filter((p: UnknownRecord) => p.category1_name === 'Bakery');
      } else if (transactionType === 'drinks') {
        filteredProducts = allProducts.filter((p: UnknownRecord) =>
          p.category1_name && (p.category1_name === 'Minuman' || p.category1_name === 'Dessert')
        );
      } else if (transactionType === 'foods') {
        filteredProducts = allProducts.filter((p: UnknownRecord) => p.category1_name === 'Makanan');
      } else if (transactionType === 'packages') {
        filteredProducts = allProducts.filter((p: UnknownRecord) =>
          String(p.category1_name || '').toUpperCase() === 'PAKET' || p.category1_id === 14
        );
      }
    }

    // Filter by harga_jual in offline mode (exclude NULL, undefined, or 0)
    // This matches the filtering logic in CenterContent.tsx
    if (!options?.isOnline) {
      const beforeCount = filteredProducts.length;
      const excludedByHarga = filteredProducts.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        const hj = product.harga_jual;
        return hj === null || hj === undefined || hj === 0;
      });
      const paketAyamExcluded = excludedByHarga.find((p: UnknownRecord) => String(p.nama || '').toLowerCase().includes('paket ayam sedih') || String(p.menu_code || '') === 'PAKET-001');
      // #region agent log
      if (transactionType === 'foods' && (paketAyamExcluded || excludedByHarga.some((p: UnknownRecord) => String(p.category2_name || '').includes('Paket Bukber')))) {
        const excludedArr = excludedByHarga.filter((p: UnknownRecord) => String(p.category2_name || '').includes('Paket Bukber')).map((p: UnknownRecord) => ({ nama: p.nama, hj: p.harga_jual }));
        const payload2 = { location: 'offlineDataFetcher.ts:fetchCategories', message: 'harga_jual filter excluded Paket Bukber', data: { beforeCount, excludedCount: excludedByHarga.length, paketAyamExcluded: !!paketAyamExcluded, paketAyamData: paketAyamExcluded ? { nama: paketAyamExcluded.nama, harga_jual: paketAyamExcluded.harga_jual, category2: paketAyamExcluded.category2_name } : null, paketBukberExcluded: excludedArr }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H2' };
        fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload2) }).catch(() => {});
      }
      // #endregion
      filteredProducts = filteredProducts.filter((p: UnknownRecord) => {
        const product = p as unknown as Product;
        const hargaJual = product.harga_jual;
        // Filter out NULL, undefined, or 0 (0 is used as fallback for products that only have platform prices)
        if (hargaJual === null || hargaJual === undefined || hargaJual === 0) {
          return false;
        }
        return true;
      });
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
    const categoriesList = Array.from(category2Set);
    const hasPaketBukber = categoriesList.some(c => c.includes('Paket Bukber'));
    if (transactionType === 'foods') {
      fetch('http://127.0.0.1:7244/ingest/c0917f49-320f-4b63-aac0-b89a407233e0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offlineDataFetcher.ts:fetchCategories',message:'foods categories result',data:{categoriesCount:categoriesList.length,hasPaketBukber,categoriesList},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2,H3'})}).catch(()=>{});
    }
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

    return categories;
  } catch (error) {
    console.error('❌ [FETCH CATEGORIES] MySQL query error:', error);return [];
  }
}



