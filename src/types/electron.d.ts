declare global {
  type ShiftPrintBreakdownSection = {
    title?: string;
    user_name: string;
    shift_start: string;
    shift_end: string | null;
    modal_awal: number;
    statistics: { order_count: number; total_amount: number; total_discount: number; voucher_count: number };
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
    customizationSales: Array<{
      option_id: number;
      option_name: string;
      customization_id: number;
      customization_name: string;
      total_quantity: number;
      total_revenue: number;
    }>;
    paymentBreakdown: Array<{ payment_method_name: string; transaction_count: number; total_amount: number }>;
    category2Breakdown: Array<{ category2_name: string; category2_id: number; total_quantity: number; total_amount: number }>;
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
  };

  interface Window {
    electronAPI: {
      // POS functionality
      printReceipt: (data: unknown) => Promise<unknown>;
      printLabel: (data: unknown) => Promise<unknown>;
      printLabelsBatch: (data: { labels: unknown[]; printerName?: string; printerType?: string }) => Promise<{ success: boolean; error?: string }>;
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
      localDbGetCategories?: () => Promise<{ category2_name: string; updated_at: number }[]>;
      localDbUpsertProducts?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetProductsByJenis?: (jenis: string) => Promise<unknown[]>;
      localDbGetProductsByCategory2?: (category2Name: string) => Promise<unknown[]>;
      localDbGetAllProducts?: () => Promise<unknown[]>;
      localDbGetBundleItems?: (productId: number) => Promise<unknown[]>;
      localDbUpsertBundleItems?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbUpdateSyncStatus?: (key: string, status: string) => Promise<{ success: boolean }>;
      localDbGetSyncStatus?: (key: string) => Promise<{ key: string; last_sync: number; status: string } | null>;
      
      // Offline transaction queue
      localDbQueueOfflineTransaction?: (transactionData: unknown) => Promise<{ success: boolean; offlineTransactionId?: number; error?: string }>;
      localDbGetPendingTransactions?: () => Promise<unknown[]>;
      localDbMarkTransactionSynced?: (offlineTransactionId: number) => Promise<{ success: boolean }>;
      localDbMarkTransactionFailed?: (offlineTransactionId: number) => Promise<{ success: boolean }>;
      localDbQueueOfflineRefund?: (refundData: unknown) => Promise<{ success: boolean; offlineRefundId?: number; error?: string }>;
      localDbGetPendingRefunds?: () => Promise<unknown[]>;
      localDbMarkRefundSynced?: (offlineRefundId: number) => Promise<{ success: boolean }>;
      localDbMarkRefundFailed?: (offlineRefundId: number) => Promise<{ success: boolean }>;
      
      // Transaction operations
      localDbGetTransactions?: (businessId?: number, limit?: number) => Promise<unknown[]>;
      localDbUpsertTransactions?: (rows: unknown[]) => Promise<unknown>;
      localDbGetTransactionItems?: (transactionId?: number | string) => Promise<unknown[]>;
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
      localDbUpsertTransactionItemCustomizations?: (rows: unknown[]) => Promise<{ success: boolean; count: number; error?: string }>;
      localDbUpsertTransactionItemCustomizationOptions?: (rows: unknown[]) => Promise<{ success: boolean; count: number; error?: string }>;
      localDbGetTransactionRefunds?: (transactionUuid: string) => Promise<unknown[]>;
      localDbUpsertTransactionRefunds?: (rows: unknown[]) => Promise<{ success: boolean; error?: string }>;
      localDbApplyTransactionRefund?: (payload: unknown) => Promise<{ success: boolean; error?: string }>;
      localDbGetUnsyncedTransactions?: (businessId?: number) => Promise<unknown[]>;
      localDbMarkTransactionsSynced?: (transactionIds: string[]) => Promise<unknown>;
      localDbResetTransactionSync?: (transactionId: string | number) => Promise<{ success: boolean }>;
      localDbMarkTransactionsSyncedByIds?: (transactionIds: number[]) => Promise<{ success: boolean }>;
      localDbArchiveTransactions?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<number>;
      localDbDeleteTransactions?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<number>;
      localDbDeleteTransactionsByEmail?: (payload: { userEmail: string }) => Promise<{ success: boolean; deleted: number; deletedItems?: number; error?: string }>;
      localDbDeleteTransactionItems?: (payload: { businessId: number; from?: string | null; to?: string | null }) => Promise<{ success: boolean; deleted?: number }>;
      
      // Comprehensive POS table operations
      // Users
      localDbUpsertUsers?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetUsers?: () => Promise<unknown[]>;
      
      // Businesses
      localDbUpsertBusinesses?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetBusinesses?: () => Promise<unknown[]>;
      
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
      
      // Supporting tables
      localDbUpsertSource?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetSource?: () => Promise<unknown[]>;
      localDbUpsertPekerjaan?: (rows: unknown[]) => Promise<{ success: boolean }>;
      localDbGetPekerjaan?: () => Promise<unknown[]>;
      
      // Banks
      localDbUpsertBanks?: (rows: unknown[]) => Promise<unknown>;
      localDbGetBanks?: () => Promise<unknown[]>;
      
      // Payment Methods
      localDbUpsertPaymentMethods?: (rows: unknown[]) => Promise<unknown>;
      localDbGetPaymentMethods?: () => Promise<unknown[]>;
      
      // Organizations
      localDbUpsertOrganizations?: (rows: unknown[]) => Promise<unknown>;
      localDbGetOrganizations?: () => Promise<unknown[]>;
      
      // Management Groups
      localDbUpsertManagementGroups?: (rows: unknown[]) => Promise<unknown>;
      localDbGetManagementGroups?: () => Promise<unknown[]>;
      
      // Categories
      localDbUpsertCategory1?: (rows: unknown[]) => Promise<unknown>;
      localDbGetCategory1?: () => Promise<unknown[]>;
      localDbUpsertCategory2?: (rows: unknown[]) => Promise<unknown>;
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
      localDbGetShiftStatistics?: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => Promise<{
        order_count: number;
        total_amount: number;
        total_discount: number;
        voucher_count: number;
      }>;
      localDbGetPaymentBreakdown?: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => Promise<Array<{
        payment_method_name: string;
        payment_method_code: string;
        transaction_count: number;
        total_amount: number;
      }>>;
      localDbGetCategory2Breakdown?: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => Promise<Array<{
        category2_name: string;
        category2_id: number;
        total_quantity: number;
        total_amount: number;
      }>>;
      localDbGetCashSummary?: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => Promise<{
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
      localDbGetProductSales?: (userId: number, shiftStart: string, shiftEnd: string | null, businessId?: number) => Promise<{
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
      printShiftBreakdown?: (data: ShiftPrintBreakdownPayload) => Promise<{ success: boolean; error?: string }>;
      
      // Printer configurations
      localDbSavePrinterConfig?: (printerType: string, systemPrinterName: string, extraSettings?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
      localDbGetPrinterConfigs?: () => Promise<unknown[]>;
      
      // Printer Management (new multi-printer system)
      generateNumericUuid?: (businessId: number) => Promise<{ success: boolean; uuid?: string; error?: string }>;
      getPrinterCounter?: (printerType: string, businessId: number, increment: boolean) => Promise<{ success: boolean; counter: number; error?: string }>;
      getPrinter2Mode?: () => Promise<{ success: boolean; mode: 'auto' | 'manual' }>;
      setPrinter2Mode?: (mode: 'auto' | 'manual') => Promise<{ success: boolean }>;
      getPrinter2AutomationSelections?: (businessId: number) => Promise<{ success: boolean; cycleNumber: number; selections: number[] }>;
      savePrinter2AutomationSelections?: (businessId: number, cycleNumber: number, selections: number[]) => Promise<{ success: boolean }>;
      generateRandomSelections?: (cycleNumber: number) => Promise<{ success: boolean; selections: number[] }>;
      logPrinter2Print?: (transactionId: string, printer2ReceiptNumber: number, mode: 'auto' | 'manual', cycleNumber?: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>;
      getPrinter2AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: unknown[] }>;
      logPrinter1Print?: (transactionId: string, printer1ReceiptNumber: number, globalCounter?: number | null, isReprint?: boolean, reprintCount?: number) => Promise<{ success: boolean }>;
      getPrinter1AuditLog?: (fromDate?: string, toDate?: string, limit?: number) => Promise<{ success: boolean; entries: unknown[] }>;
      localDbUpsertPrinterAudits?: (printerType: 'receipt' | 'receiptize', rows: unknown[]) => Promise<{ success: boolean; count?: number; error?: string }>;
      localDbUpsertPrinterDailyCounters?: (rows: Array<{ printer_type: string; business_id: number; date: string; counter: number }>) => Promise<{ success: boolean; count?: number; error?: string }>;
      localDbResetPrinterDailyCounters?: (businessId: number) => Promise<{ success: boolean }>;
      localDbGetUnsyncedPrinterAudits?: () => Promise<{ p1: unknown[]; p2: unknown[] }>;
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
    };
  }
}

export {};
