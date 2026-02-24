declare global {
  type ShiftPrintRefundRow = {
    refund_uuid?: string;
    transaction_uuid?: string;
    transaction_uuid_id?: string;
    refund_amount?: number;
    refunded_at?: string;
    payment_method?: string;
    final_amount?: number;
    reason?: string | null;
    issuer_email?: string | null;
    waiter_name?: string | null;
    customer_name?: string | null;
  };

  type ShiftPrintBreakdownSection = {
    title?: string;
    user_name: string;
    shift_start: string;
    shift_end: string | null;
    modal_awal: number;
    statistics: { order_count: number; total_amount: number; total_discount: number; voucher_count: number; total_cu?: number };
    gross_total_omset?: number;
    refunds?: ShiftPrintRefundRow[];
    cancelledItems?: Array<{ product_name: string; quantity: number; total_price: number; cancelled_at: string; cancelled_by_user_name: string; cancelled_by_waiter_name: string; receipt_number?: string | null; customer_name?: string | null }>;
    productSales: Array<{
      product_name: string;
      total_quantity: number;
      total_subtotal: number;
      customization_subtotal: number;
      base_subtotal: number;
      base_unit_price: number;
      platform: string;
      transaction_type: string;
      is_bundle_item?: boolean;
    }>;
    packageSalesBreakdown?: Array<{
      package_product_id: number;
      package_product_name: string;
      total_quantity: number;
      total_amount: number;
      base_unit_price: number;
      lines: Array<{ product_id: number; product_name: string; total_quantity: number }>;
    }>;
    customizationSales: Array<{
      option_id: number;
      option_name: string;
      customization_id: number;
      customization_name: string;
      total_quantity: number;
      total_revenue: number;
    }>;
    paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number; total_amount: number }>;
    category1Breakdown?: Array<{ category1_name: string; category1_id: number; total_quantity: number; total_amount: number }>;
    category2Breakdown: Array<{ category2_name: string; category2_id: number; total_quantity: number; total_amount: number }>;
    voucherBreakdown?: Record<string, { count: number; total: number }>;
    cashSummary: {
      cash_shift: number;
      cash_shift_sales?: number;
      cash_shift_refunds?: number;
      cash_whole_day: number;
      cash_whole_day_sales?: number;
      cash_whole_day_refunds?: number;
      total_cash_in_cashier: number;
      kas_mulai?: number;
      kas_expected?: number;
      kas_akhir?: number | null;
      kas_selisih?: number | null;
      kas_selisih_label?: 'balanced' | 'plus' | 'minus' | null;
    };
  };

  type ShiftPrintBreakdownPayload = ShiftPrintBreakdownSection & {
    business_id?: number;
    printerType?: string;
    wholeDayReport?: ShiftPrintBreakdownSection;
    sectionOptions?: {
      ringkasan?: boolean;
      barangTerjual?: boolean;
      paymentMethod?: boolean;
      categoryI?: boolean;
      categoryII?: boolean;
      paket?: boolean;
      toppingSales?: boolean;
      itemDibatalkan?: boolean;
    };
  };

  interface Window {
    electronAPI: {
      // POS functionality
      printReceipt: (data: unknown) => Promise<unknown>;
      printLabel: (data: unknown) => Promise<unknown>;
      printLabelsBatch: (data: {
        requestId?: string;
        labels: unknown[];
        printerName?: string;
        printerType?: string;
        business_id?: number;
        orderContext?: { waiterName?: string; customerName?: string; tableName?: string; orderTime?: string; itemsHtml?: string; itemsHtmlCategory1?: string; itemsHtmlCategory2?: string; category1Name?: string; category2Name?: string; categories?: Array<{ categoryName: string; itemsHtml: string }> };
        isOnlineOrder?: boolean;
      }) => Promise<{ success: boolean; error?: string }>;
      openCashDrawer: () => Promise<unknown>;
      playSound: (soundType: string) => Promise<unknown>;
      // System printers
      listPrinters: () => Promise<{ success: boolean; printers: Array<{ name: string; displayName?: string; status?: string; isDefault?: boolean }> }>;

      // Window controls
      closeWindow: () => Promise<unknown>;
      minimizeWindow: () => Promise<unknown>;
      maximizeWindow: () => Promise<unknown>;
      navigateTo: (path: string) => Promise<unknown>;
      focusWindow: () => Promise<{ success: boolean; error?: string }>;

      // Authentication events
      notifyLoginSuccess: () => Promise<unknown>;
      notifyLogout: () => Promise<unknown>;

      // Menu events
      onMenuNewOrder: (callback: () => void) => void;

      // Dual-display communication
      updateCustomerDisplay: (data: unknown) => Promise<unknown>;
      updateCustomerSlideshow: (data: unknown) => Promise<unknown>;
      getCustomerDisplayStatus: () => Promise<unknown>;
      createCustomerDisplay: () => Promise<unknown>;
      createBaristaKitchenWindow: () => Promise<{ success: boolean; error?: string }>;
      createKitchenWindow: () => Promise<{ success: boolean; error?: string }>;
      createBaristaWindow: () => Promise<{ success: boolean; error?: string }>;

      // Customer display event listeners
      onOrderUpdate?: (callback: (data: unknown) => void) => void;
      onSlideshowUpdate?: (callback: (data: unknown) => void) => void;

      // Slideshow image management (userData storage)
      getSlideshowImages?: () => Promise<{
        success: boolean;
        images: Array<{
          id: string;
          filename: string;
          path: string;
          localPath: string;
          title: string;
          duration: number;
          order: number;
          size: number;
          createdAt: string;
        }>;
        count: number;
        path?: string;
        error?: string;
      }>;
      saveSlideshowImage?: (imageData: { filename: string; buffer: Buffer }) => Promise<{
        success: boolean;
        message?: string;
        filename?: string;
        error?: string;
      }>;
      deleteSlideshowImage?: (filename: string) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
      }>;
      openSlideshowFolder?: () => Promise<{
        success: boolean;
        message?: string;
        path?: string;
        error?: string;
      }>;
      readSlideshowImage?: (filename: string) => Promise<{
        success: boolean;
        buffer?: Buffer;
        mimeType?: string;
        filename?: string;
        error?: string;
      }>;
      migrateSlideshowImages?: () => Promise<{
        success: boolean;
        message?: string;
        migrated?: number;
        existing?: number;
        error?: string;
      }>;

      // Offline/local DB operations
      localDbUpsertCategories?: (rows: { category2_name: string; updated_at?: number }[]) => Promise<{ success: boolean }>;
      downloadAndRewriteSyncImages?: (payload: { baseUrl: string; products: unknown[]; businesses: unknown[] }) => Promise<{ products: unknown[]; businesses: unknown[] }>;
      localDbGetCategories?: () => Promise<{ category2_name: string; updated_at: number }[]>;
      localDbUpsertProducts?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbCleanupOrphanedProducts?: (businessId: number, syncedProductIds: number[]) => Promise<{ success: boolean; deletedCount?: number; deletedProductIds?: number[]; error?: string }>;
      localDbCleanupOrphanedEmployees?: (businessId: number, syncedEmployeeIds: number[]) => Promise<{ success: boolean; deletedCount?: number; deletedEmployeeIds?: number[]; error?: string }>;
      localDbGetProductsByJenis?: (jenis: string) => Promise<unknown[]>;
      localDbGetProductsByCategory2?: (category2Name: string) => Promise<unknown[]>;
      localDbGetAllProducts?: (businessId?: number) => Promise<unknown[]>;
      localDbGetBundleItems?: (productId: number) => Promise<unknown[]>;
      localDbUpsertBundleItems?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetPackageItems?: (packageProductId: number | string) => Promise<unknown[]>;
      localDbUpsertPackageItems?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbUpsertPackageItemProducts?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbMarkInactiveBundleItems?: (businessId: number, syncedBundleItemIds: number[]) => Promise<{ success: boolean; error?: string }>;
      localDbMarkInactivePackageItems?: (businessId: number, syncedPackageItemIds: number[]) => Promise<{ success: boolean; error?: string }>;
      localDbMarkInactivePackageItemProducts?: (businessId: number, syncedPackageItemProductIds: number[]) => Promise<{ success: boolean; error?: string }>;
      localDbUpdateSyncStatus?: (key: string, status: string) => Promise<{ success: boolean }>;
      localDbGetSyncStatus?: (key: string) => Promise<{ key: string; last_sync: number; status: string } | null>;

      // Transaction sync status (using transactions table directly)
      localDbMarkTransactionFailed?: (transactionId: string) => Promise<{ success: boolean }>;
      localDbQueueOfflineRefund?: (refundData: unknown) => Promise<{ success: boolean; offlineRefundId?: number; error?: string }>;
      localDbGetPendingRefunds?: () => Promise<unknown[]>;
      localDbMarkRefundSynced?: (offlineRefundId: number) => Promise<{ success: boolean }>;
      localDbMarkRefundFailed?: (offlineRefundId: number) => Promise<{ success: boolean }>;
      localDbDeleteRefund?: (offlineRefundId: number) => Promise<{ success: boolean; error?: string }>;
      localDbCheckTransactionExists?: (transactionUuid: string) => Promise<{ exists: boolean; error?: string }>;

      // Restaurant Table Layout
      getRestaurantRooms?: (businessId: number) => Promise<Array<{
        canvas_width?: number | null;
        canvas_height?: number | null;
        font_size_multiplier?: number | null;
        id: number;
        business_id: number;
        name: string;
        created_at: string;
        updated_at: string;
        table_count: number;
      }>>;
      getRestaurantTables?: (roomId: number) => Promise<Array<{
        id: number;
        room_id: number;
        table_number: string;
        position_x: number | string;
        position_y: number | string;
        width: number | string;
        height: number | string;
        capacity: number;
        shape: 'circle' | 'rectangle';
      }>>;
      getRestaurantLayoutElements?: (roomId: number) => Promise<Array<{
        id: number;
        room_id: number;
        label: string;
        position_x: number | string;
        position_y: number | string;
        width: number | string;
        height: number | string;
        element_type: string;
        color: string;
        text_color: string;
      }>>;
      localDbUpsertRestaurantRooms?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbUpsertRestaurantTables?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbUpsertRestaurantLayoutElements?: (rows: unknown[]) => Promise<{ success: boolean }>;

      // Transaction operations
      localDbGetTransactionByUuid?: (uuid: string) => Promise<unknown>;
      localDbGetTransactions?: (businessId?: number, limit?: number, options?: { todayOnly?: boolean }) => Promise<unknown[]>;
      localDbUpdateTransactionShift?: (transactionUuid: string, shiftUuid: string | null) => Promise<{ success: boolean; error?: string }>;
      localDbDeleteSingleTransactionPreview?: (transactionUuid: string) => Promise<{
        success: boolean;
        error?: string;
        transactionUuid?: string;
        queries?: Array<{ sql: string; params: (string | number)[]; description: string }>;
        systemPosQueries?: Array<{ sql: string; params: (string | number)[]; description: string }>;
      }>;
      localDbDeleteSingleTransaction?: (transactionUuid: string) => Promise<{ success: boolean; error?: string }>;
      localDbUpsertTransactions?: (rows: unknown[]) => Promise<unknown>;
      localDbUpdateTransactionVoucher?: (transactionId: string, payload: { voucher_discount: number; voucher_type: string; voucher_value: number | null; voucher_label: string | null; final_amount: number }) => Promise<{ success: boolean; error?: string }>;
      localDbUpdateTransactionWaiter?: (transactionId: string, waiterId: number | null) => Promise<{ success: boolean; error?: string }>;
      localDbUpdateTransactionUser?: (transactionId: string, userId: number, useSystemPos?: boolean) => Promise<{ success: boolean; error?: string }>;
      localDbGetTransactionCheckerPrinted?: (transactionUuid: string) => Promise<{ success: boolean; checker_printed: boolean }>;
      localDbSetTransactionCheckerPrinted?: (transactionUuid: string) => Promise<{ success: boolean }>;
      localDbGetTransactionItems?: (transactionId?: number | string) => Promise<unknown[]>;
      localDbGetDistinctItemWaiterIdsByTransaction?: (transactionIds: string[]) => Promise<Record<string, number[]>>;
      localDbGetTransactionItemCustomizationsNormalized?: (transactionId: string) => Promise<{
        customizations: Array<{
          id: number;
          transaction_item_id: string;
          customization_type_id: number;
          bundle_product_id: number | null;
          created_at: string;
        }>;
        options: Array<{
          id: number;
          transaction_item_customization_id: number;
          customization_option_id: number;
          option_name: string;
          price_adjustment: number;
          created_at: string;
        }>;
      }>;
      localDbUpsertTransactionItems?: (rows: unknown[]) => Promise<unknown>;
      localDbGetPackageLines?: (uuidTransactionItemIds: string[]) => Promise<Array<{ id: number; uuid_transaction_item_id: string; product_id: number; quantity: number; finished_at: string | null }>>;
      localDbGetTransactionIdsWithPackage?: (transactionIds: string[]) => Promise<string[]>;
      localDbUpdatePackageLine?: (payload: { id: number; finished_at: string | null }) => Promise<{ success: boolean; error?: string }>;
      localDbUpsertTransactionItemCustomizations?: (rows: unknown[]) => Promise<{ success: boolean; count: number; error?: string }>;
      localDbUpsertTransactionItemCustomizationOptions?: (rows: unknown[]) => Promise<{ success: boolean; count: number; error?: string }>;
      localDbGetTransactionRefunds?: (transactionUuid: string) => Promise<unknown[]>;
      localDbGetShiftRefunds?: (payload: {
        userId: number;
        businessId: number;
        shiftUuid?: string | null;
        shiftUuids?: string[];
        shiftStart: string;
        shiftEnd?: string | null;
      }) => Promise<Array<{
        refund_uuid: string;
        transaction_uuid: string;
        transaction_uuid_id: string;
        refund_amount: number;
        cash_delta: number;
        refunded_at: string;
        refunded_by: number;
        payment_method_id: number;
        payment_method: string;
        final_amount: number;
        transaction_created_at: string;
      }>>;
      localDbUpsertTransactionRefunds?: (rows: unknown[]) => Promise<{ success: boolean; error?: string }>;
      localDbApplyTransactionRefund?: (payload: unknown) => Promise<{ success: boolean; error?: string }>;
      localDbGetUnsyncedTransactions?: (businessId?: number) => Promise<unknown[]>;
      localDbGetAllTransactions?: (businessId?: number, from?: string, to?: string) => Promise<unknown[]>;
      localDbDeleteUnsyncedTransactions?: (businessId?: number) => Promise<{ success: boolean; deletedCount?: number; error?: string }>;
      localDbMarkTransactionsSynced?: (transactionIds: string[]) => Promise<unknown>;
      localDbResetTransactionSync?: (transactionId: string | number) => Promise<{ success: boolean; error?: string; affectedRows?: number }>;
      localDbMarkTransactionsSyncedByIds?: (transactionIds: number[]) => Promise<{ success: boolean }>;
      localDbArchiveTransactions?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<number>;
      localDbDeleteTransactions?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<number>;
      localDbDeleteTransactionItems?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<{ success: boolean; deleted?: number }>;
      localDbSplitBill?: (payload: { sourceTransactionUuid: string; destinationTransactionUuid: string; itemIds: (number | string)[] }) => Promise<{ success: boolean; error?: string }>;
      localDbUpsertActivityLogs?: (rows: Array<{ user_id: number; action: string; business_id: number; details: string; created_at: string }>) => Promise<{ success: boolean; error?: string }>;

      // Comprehensive POS table operations
      // Users
      localDbUpsertUsers?: (rows: unknown[], skipRoleValidation?: boolean) => Promise<{ success: boolean }>;
      localDbGetUsers?: () => Promise<unknown[]>;

      // Businesses
      localDbUpsertBusinesses?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetBusinesses?: () => Promise<unknown[]>;
      cacheBusinessLogoForLogin?: (businessId: number, baseUrl?: string) => Promise<{ success: boolean }>;
      getLoginLogo?: () => Promise<{ dataUrl: string | null }>;

      // Ingredients
      localDbUpsertIngredients?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetIngredients?: (businessId?: number) => Promise<unknown[]>;

      // COGS
      localDbUpsertCogs?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetCogs?: () => Promise<unknown[]>;

      // Contacts
      localDbUpsertContacts?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetContacts?: (teamId?: number) => Promise<unknown[]>;

      // Teams
      localDbUpsertTeams?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetTeams?: () => Promise<unknown[]>;

      // Employees Position
      localDbUpsertEmployeesPosition?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetEmployeesPosition?: () => Promise<unknown[]>;

      // Employees
      localDbUpsertEmployees?: (rows: unknown[], skipValidation?: boolean) => Promise<{ success: boolean; skipped?: number; error?: string }>;
      localDbGetEmployees?: () => Promise<Record<string, unknown>[]>;

      // Roles & permissions
      localDbUpsertRoles?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetRoles?: () => Promise<unknown[]>;
      localDbUpsertPermissions?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetPermissions?: () => Promise<unknown[]>;
      localDbUpsertRolePermissions?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetRolePermissions?: (roleId: number) => Promise<unknown[]>;
      localDbGetUserAuth?: (email: string) => Promise<{
        id: number;
        email: string;
        password: string | null;
        name: string | null;
        role_id: number | null;
        organization_id: number | null;
        role_name: string | null;
        permissions: string[];
      } | null>;
      checkOfflineDbExists?: () => Promise<{ exists: boolean; path?: string; error?: string }>;
      localDbPing?: () => Promise<{ success: boolean; ms?: number; error?: string }>;

      // Supporting tables
      localDbUpsertSource?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetSource?: () => Promise<unknown[]>;
      // Skip pekerjaan - not needed in POS app (CRM-only)

      // Banks
      localDbUpsertBanks?: (rows: unknown[]) => Promise<unknown>;
      localDbGetBanks?: () => Promise<unknown[]>;

      // Receipt Settings and Templates
      localDbUpsertReceiptSettings?: (rows: unknown[]) => Promise<{ success: boolean; error?: string }>;
      localDbUpsertReceiptTemplates?: (rows: unknown[]) => Promise<{ success: boolean; error?: string }>;

      // Payment Methods
      localDbUpsertPaymentMethods?: (rows: unknown[]) => Promise<unknown>;
      localDbGetPaymentMethods?: () => Promise<unknown[]>;

      // Organizations
      localDbUpsertOrganizations?: (rows: unknown[], skipOwnerValidation?: boolean) => Promise<{ success: boolean }>;
      localDbGetOrganizations?: () => Promise<unknown[]>;

      // Skip management_groups - not needed in POS app (CRM-only)

      // Categories
      localDbUpsertCategory1?: (rows: unknown[]) => Promise<unknown>;
      localDbGetCategory1?: () => Promise<unknown[]>;
      localDbUpsertCategory2?: (rows: unknown[], junctionData?: Array<{ category2_id: number; business_id: number }>) => Promise<unknown>;
      localDbUpsertProductBusinesses?: (rows: Array<{ product_id: number; business_id: number }>) => Promise<{ success: boolean }>;
      localDbGetCategory2?: () => Promise<unknown[]>;

      // CL Accounts
      localDbUpsertClAccounts?: (rows: unknown[]) => Promise<unknown>;
      localDbGetClAccounts?: () => Promise<unknown[]>;

      // Customization
      localDbUpsertCustomizationTypes?: (rows: unknown[]) => Promise<unknown>;
      localDbUpsertCustomizationOptions?: (rows: unknown[]) => Promise<unknown>;
      localDbUpsertProductCustomizations?: (rows: unknown[]) => Promise<unknown>;
      localDbGetProductCustomizations?: (productId: number) => Promise<unknown[]>;


      // Shifts
      localDbGetActiveShift?: (userId: number, businessId?: number) => Promise<{
        shift: {
          id: number;
          uuid_id: string;
          business_id: number;
          user_id: number;
          user_name: string;
          shift_start: string;
          shift_end: string | null;
          modal_awal: number;
          status: string;
          created_at: string;
          kas_akhir?: number | null;
          kas_expected?: number | null;
          kas_selisih?: number | null;
          kas_selisih_label?: 'balanced' | 'plus' | 'minus' | null;
          cash_sales_total?: number | null;
          cash_refund_total?: number | null;
        } | null;
        isCurrentUserShift: boolean;
      }>;
      localDbCreateShift?: (shiftData: {
        uuid_id: string;
        business_id: number;
        user_id: number;
        user_name: string;
        modal_awal: number;
      }) => Promise<{
        success: boolean;
        error?: string;
        activeShift?: {
          id: number;
          uuid_id: string; // Add uuid_id to activeShift
          user_id: number;
          user_name: string;
          shift_start: string;
        };
      }>;
      localDbEndShift?: (payload: { shiftId: number; kasAkhir?: number | null }) => Promise<{
        success: boolean;
        error?: string;
        cashSummary?: {
          kas_mulai: number;
          kas_expected: number;
          kas_akhir: number | null;
          cash_sales: number;
          cash_refunds: number;
          variance: number | null;
          variance_label: 'balanced' | 'plus' | 'minus';
        };
      }>;
      localDbGetShiftStatistics?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<{
        order_count: number;
        total_amount: number;
        total_discount: number;
        voucher_count: number;
        total_cu: number;
      }>;
      localDbGetVoucherBreakdown?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Record<string, { count: number; total: number }>>;
      localDbGetPaymentBreakdown?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
        payment_method_name: string;
        payment_method_code: string;
        transaction_count: number;
        total_amount: number;
      }>>;
      localDbGetCategory1Breakdown?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
        category1_name: string;
        category1_id: number;
        total_quantity: number;
        total_amount: number;
      }>>;
      localDbGetCategory2Breakdown?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
        category2_name: string;
        category2_id: number;
        total_quantity: number;
        total_amount: number;
      }>>;
      localDbGetShiftCancelledItems?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
        product_name: string;
        quantity: number;
        unit_price: number;
        total_price: number;
        cancelled_at: string;
        cancelled_by_user_name: string;
        cancelled_by_waiter_name: string;
        receipt_number?: string | null;
        customer_name?: string | null;
      }>>;
      localDbGetCashSummary?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<{
        cash_shift: number;
        cash_shift_sales: number;
        cash_shift_refunds: number;
        cash_whole_day: number;
        cash_whole_day_sales: number;
        cash_whole_day_refunds: number;
      }>;
      localDbGetShifts?: (filters?: { businessId?: number; startDate?: string; endDate?: string; userId?: number; limit?: number; offset?: number }) => Promise<{ shifts: unknown[]; total: number }>;
      localDbGetShiftUsers?: (businessId?: number) => Promise<unknown[]>;
      localDbGetUnsyncedShifts?: (businessId?: number) => Promise<unknown[]>;
      localDbMarkShiftsSynced?: (shiftIds: number[]) => Promise<{ success: boolean }>;
      localDbUpsertShifts?: (rows: unknown[]) => Promise<{ success: boolean; count: number; error?: string }>;
      localDbCheckTodayTransactions?: (userId: number, shiftStart: string, businessId?: number) => Promise<{
        hasTransactions: boolean;
        count: number;
        earliestTime: string | null;
      }>;
      localDbUpdateShiftStart?: (shiftId: number, newStartTime: string) => Promise<{ success: boolean; error?: string }>;
      localDbGetProductSales?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<{
        products: Array<{
          product_id: number;
          product_name: string;
          product_code: string;
          platform: string;
          transaction_type: string;
          total_quantity: number;
          total_subtotal: number;
          customization_subtotal: number;
          base_subtotal: number;
          base_unit_price: number;
          is_bundle_item?: boolean;
        }>;
        customizations: Array<{
          option_id: number;
          option_name: string;
          customization_id: number;
          customization_name: string;
          total_quantity: number;
          total_revenue: number;
        }>;
      }>;
      localDbGetPackageSalesBreakdown?: (userId: number | null, shiftStart: string, shiftEnd: string | null, businessId?: number, shiftUuid?: string | null, shiftUuids?: string[]) => Promise<Array<{
        package_product_id: number;
        package_product_name: string;
        total_quantity: number;
        total_amount: number;
        base_unit_price: number;
        lines: Array<{ product_id: number; product_name: string; total_quantity: number }>;
      }>>;
      printShiftBreakdown?: (data: ShiftPrintBreakdownPayload) => Promise<{ success: boolean; error?: string }>;
      printTransactionsReport?: (payload: {
        businessId: number;
        businessName: string;
        dateRangeStart: string;
        dateRangeEnd: string;
        transactions: Array<{
          num: number;
          badge: 'R' | 'RR';
          uuid: string;
          waktu: string;
          metode: string;
          diTa: string;
          total: string;
          discVc: string;
          final: string;
          refund: string;
          pelanggan: string;
          waiter: string;
          kasir: string;
        }>;
      }) => Promise<{ success: boolean; error?: string }>;

      // Printer configurations
      localDbSavePrinterConfig?: (printerType: string, systemPrinterName: string, extraSettings?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
      localDbGetPrinterConfigs?: () => Promise<unknown[]>;

      // Local settings (NOT synced to server)
      localDbGetSetting?: (settingKey: string) => Promise<string | null>;
      localDbSaveSetting?: (settingKey: string, settingValue: string) => Promise<{ success: boolean; error?: string }>;

      // Printer Management (new multi-printer system)
      generateNumericUuid?: (businessId: number) => Promise<{ success: boolean; uuid?: string; error?: string }>;
      getPrinterCounter?: (printerType: string, businessId: number, increment: boolean) => Promise<{ success: boolean; counter: number; error?: string }>;
      getPrinter2Mode?: () => Promise<{ success: boolean; mode: 'auto' | 'manual' }>;
      setPrinter2Mode?: (mode: 'auto' | 'manual') => Promise<{ success: boolean }>;
      getPrinter2AutomationSelections?: (businessId: number) => Promise<{ success: boolean; cycleNumber: number; selections: number[] }>;
      savePrinter2AutomationSelections?: (businessId: number, cycleNumber: number, selections: number[]) => Promise<{ success: boolean }>;
      generateRandomSelections?: (cycleNumber: number) => Promise<{ success: boolean; selections: number[] }>;
      logPrinter2Print?: (transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>;
      getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number, transactionId?: string) => Promise<{ success: boolean; entries: unknown[] }>;
      logPrinter1Print?: (transactionId: string, printer1ReceiptNumber: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>;
      getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number, transactionId?: string) => Promise<{ success: boolean; entries: unknown[] }>;
      moveTransactionToPrinter2?: (transactionId: string) => Promise<{ success: boolean; error?: string }>;
      queueTransactionForSystemPos?: (transactionId: string) => Promise<{ success: boolean; alreadyQueued?: boolean; alreadySynced?: boolean; error?: string }>;
      getSystemPosQueue?: () => Promise<{ success: boolean; queue: Array<{ id: number; transaction_id: string; queued_at: number; synced_at: number | null; retry_count: number; last_error: string | null }> }>;
      markSystemPosSynced?: (transactionId: string) => Promise<{ success: boolean }>;
      markSystemPosFailed?: (transactionId: string, error: string) => Promise<{ success: boolean }>;
      resetSystemPosRetryCount?: (transactionIds?: string[]) => Promise<{ success: boolean; error?: string }>;
      repopulateSystemPosQueue?: (options?: { days?: number }) => Promise<{ success: boolean; count?: number; error?: string }>;
      getSystemPosResyncPreview?: (fromDate: string, toDate: string) => Promise<{
        success: boolean;
        count: number;
        transactionIds?: string[];
        error?: string;
      }>;
      runSystemPosResync?: (fromDate: string, toDate: string) => Promise<{
        success: boolean;
        count: number;
        synced: number;
        failed: number;
        errors?: Array<{ transactionId: string; error: string }>;
        error?: string;
        message?: string;
      }>;
      upsertMasterDataToSystemPos?: () => Promise<{ success: boolean; upserted: number; error?: string }>;
      syncRefundedTransactionsToSystemPos?: () => Promise<{ success: boolean; syncedCount: number; error?: string }>;
      debugSystemPosTransaction?: (transactionId: string) => Promise<{
        success: boolean;
        transaction: { id: string; business_id: number; user_id: number; created_at: string; synced_at: number | null } | null;
        queue: { id: number; transaction_id: string; queued_at: number; synced_at: number | null; retry_count: number; last_error: string | null } | null;
        existsInLocalDb: boolean;
        isQueued: boolean;
        isSynced: boolean;
        retryCount: number;
        lastError: string | null;
        error?: string;
      }>;
      localDbUpsertPrinterAudits?: (printerType: 'receipt' | 'receiptize', rows: unknown[]) => Promise<{ success: boolean; count?: number; error?: string }>;
      localDbGetAllPrinterDailyCounters?: () => Promise<Array<{ printer_type: string; business_id: number; date: string; counter: number }>>;
      localDbUpsertPrinterDailyCounters?: (rows: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) => Promise<{ success: boolean; count?: number; error?: string }>;
      localDbResetPrinterDailyCounters?: (businessId: number) => Promise<{ success: boolean }>;
      localDbGetUnsyncedPrinterAudits?: () => Promise<{ p1: unknown[]; p2: unknown[] }>;
      localDbGetPrinterAuditsByTransactionId?: (transactionId: string) => Promise<{ printer1: unknown[]; printer2: unknown[] }>;
      localDbMarkPrinterAuditsSynced?: (payload: { p1Ids?: number[]; p2Ids?: number[] }) => Promise<{ success: boolean }>;

      // Database Restore
      restoreFromServer?: (options: {
        businessId: number;
        apiUrl: string;
        includeTransactions?: boolean;
      }) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        stats: Record<string, number>;
      }>;

      // Admin: Delete transactions by user email or NULL
      localDbDeleteTransactionsByRole?: () => Promise<{
        success: boolean;
        message?: string;
        deleted?: number;
        deletedItems?: number;
        details?: {
          database: string;
          targetUserIds: number[];
          printer1_audit_log: number;
          printer2_audit_log: number;
          transaction_items: number;
          transactions: number;
          success: boolean;
          error: string | null;
        };
        error?: string;
      }>;


      // Configuration Management
      getAppConfig?: () => Promise<{ success: boolean; config: { serverHost?: string; apiUrl?: string; dbUser?: string; dbPassword?: string; dbName?: string; dbPort?: number } | null; error?: string }>;
      getEffectiveDbConfig?: () => Promise<{ success: boolean; host?: string; database?: string; port?: number; source?: 'saved' | 'env' | 'default'; error?: string }>;
      saveAppConfig?: (config: { serverHost?: string; apiUrl?: string; dbUser?: string; dbPassword?: string; dbName?: string; dbPort?: number }) => Promise<{ success: boolean; error?: string }>;
      resetAppConfig?: () => Promise<{ success: boolean; error?: string }>;
      testDbConnection?: (config: { serverHost?: string; dbUser?: string; dbPassword?: string; dbName?: string; dbPort?: number }) => Promise<{ success: boolean; message?: string; error?: string }>;

      // Receipt Template and Settings Management
      getReceiptTemplate?: (templateType: 'receipt' | 'bill' | 'checker', businessId?: number) => Promise<{ success: boolean; template: string | null; error?: string }>;
      getReceiptTemplates?: (templateType: 'receipt' | 'bill' | 'checker', businessId?: number) => Promise<{ success: boolean; templates: Array<{ id: number; name: string; is_default: boolean }>; error?: string }>;
      getReceiptTemplateById?: (id: number) => Promise<{ success: boolean; templateCode: string | null; showNotes?: boolean; oneLabelPerProduct?: boolean; error?: string }>;
      setDefaultReceiptTemplate?: (templateType: 'receipt' | 'bill' | 'checker', templateName: string, businessId?: number) => Promise<{ success: boolean; error?: string }>;
      saveReceiptTemplate?: (templateType: 'receipt' | 'bill' | 'checker', templateCode: string, templateName?: string, businessId?: number, showNotes?: boolean, oneLabelPerProduct?: boolean) => Promise<{ success: boolean; error?: string }>;
      updateReceiptTemplate?: (id: number, templateCode: string, templateName?: string | null, showNotes?: boolean, oneLabelPerProduct?: boolean) => Promise<{ success: boolean; error?: string }>;
      uploadTemplateToVps?: (id: number) => Promise<{ success: boolean; skipped?: boolean; message: string }>;
      downloadTemplateFromVps?: (id: number) => Promise<{ success: boolean; skipped?: boolean; message: string }>;
      getReceiptSettings?: (businessId?: number) => Promise<{
        success: boolean;
        settings: {
          id: number;
          business_id: number | null;
          store_name: string | null;
          address: string | null;
          phone_number: string | null;
          contact_phone: string | null;
          logo_base64: string | null;
          footer_text: string | null;
          partnership_contact: string | null;
          is_active: number;
          created_at: string;
          updated_at: string;
        } | null;
        error?: string;
      }>;
      saveReceiptSettings?: (settings: {
        store_name?: string | null;
        address?: string | null;
        phone_number?: string | null;
        contact_phone?: string | null;
        logo_base64?: string | null;
        footer_text?: string | null;
        partnership_contact?: string | null;
      }, businessId?: number) => Promise<{ success: boolean; error?: string }>;
      uploadReceiptSettingsToVps?: (businessId?: number) => Promise<{ success: boolean; message: string }>;
    };
  }
}

export { };
