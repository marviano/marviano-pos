declare global {
  interface Window {
    electronAPI: {
      // POS functionality
      printReceipt: (data: any) => Promise<any>;
      openCashDrawer: () => Promise<any>;
      playSound: (soundType: string) => Promise<any>;
      
      // Window controls
      closeWindow: () => Promise<any>;
      minimizeWindow: () => Promise<any>;
      maximizeWindow: () => Promise<any>;
      navigateTo: (path: string) => Promise<any>;
      
      // Authentication events
      notifyLoginSuccess: () => Promise<any>;
      notifyLogout: () => Promise<any>;
      
      // Menu events
      onMenuNewOrder: (callback: () => void) => void;
      
      // Dual-display communication
      updateCustomerDisplay: (data: any) => Promise<any>;
      updateCustomerSlideshow: (data: any) => Promise<any>;
      getCustomerDisplayStatus: () => Promise<any>;
      createCustomerDisplay: () => Promise<any>;
      
      // Customer display event listeners
      onOrderUpdate?: (callback: (data: any) => void) => void;
      onSlideshowUpdate?: (callback: (data: any) => void) => void;
      
      // Offline/local DB operations
      localDbUpsertCategories?: (rows: { jenis: string; updated_at?: number }[]) => Promise<{ success: boolean }>;
      localDbGetCategories?: () => Promise<{ jenis: string; updated_at: number }[]>;
      localDbUpsertProducts?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetProductsByJenis?: (jenis: string) => Promise<any[]>;
      localDbGetAllProducts?: () => Promise<any[]>;
      localDbUpdateSyncStatus?: (key: string, status: string) => Promise<{ success: boolean }>;
      localDbGetSyncStatus?: (key: string) => Promise<{ key: string; last_sync: number; status: string } | null>;
      
      // Comprehensive POS table operations
      // Users
      localDbUpsertUsers?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetUsers?: () => Promise<any[]>;
      
      // Businesses
      localDbUpsertBusinesses?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetBusinesses?: () => Promise<any[]>;
      
      // Ingredients
      localDbUpsertIngredients?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetIngredients?: (businessId?: number) => Promise<any[]>;
      
      // COGS
      localDbUpsertCogs?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetCogs?: () => Promise<any[]>;
      
      // Contacts
      localDbUpsertContacts?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetContacts?: (teamId?: number) => Promise<any[]>;
      
      // Teams
      localDbUpsertTeams?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetTeams?: () => Promise<any[]>;
      
      // Supporting tables
      localDbUpsertSource?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetSource?: () => Promise<any[]>;
      localDbUpsertPekerjaan?: (rows: any[]) => Promise<{ success: boolean }>;
      localDbGetPekerjaan?: () => Promise<any[]>;
    };
  }
}

export {};
