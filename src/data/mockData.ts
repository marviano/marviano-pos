// Mock data structure matching your database schema
// Business: Momoyo Bakery Kalimantan (business_id: 14)

export const mockCategories = [
  { jenis: "Ice Cream Cone", active: true },
  { jenis: "Sundae", active: false },
  { jenis: "Shake Series", active: false },
  { jenis: "Fruit Tea", active: false },
  { jenis: "Milk Tea", active: false },
  { jenis: "Jumbo 1L", active: false },
  { jenis: "Egg Waffle", active: false },
  { jenis: "YO!Flip", active: false }
];

export const mockProducts = [
  {
    id: 1,
    business_id: 1,
    menu_code: "ICE001",
    nama: "Ice Cream Cone + Cup",
    kategori: "Ice Cream Cone",
    harga_jual: 10000,
    status: "active"
  },
  {
    id: 2,
    business_id: 1,
    menu_code: "ICE002",
    nama: "Ice Cream Cone - Mix",
    kategori: "Ice Cream Cone",
    harga_jual: 8000,
    status: "active"
  },
  {
    id: 3,
    business_id: 1,
    menu_code: "ICE003",
    nama: "Ice Cream Cone - Vanilla",
    kategori: "Ice Cream Cone",
    harga_jual: 8000,
    status: "active"
  },
  {
    id: 4,
    business_id: 1,
    menu_code: "ICE004",
    nama: "Ice Cream Cone - Strawberry",
    kategori: "Ice Cream Cone",
    harga_jual: 8000,
    status: "active"
  },
  {
    id: 5,
    business_id: 1,
    menu_code: "ICE005",
    nama: "Ice Cream Cone - Matcha",
    kategori: "Ice Cream Cone",
    harga_jual: 8000,
    status: "active"
  }
];

export const mockMenuItems = [
  { id: 1, name: "Kasir", active: true },
  { id: 2, name: "Daftar Transaksi", active: false },
  { id: 4, name: "Pesan Antar", active: false, disabled: true },
  { id: 5, name: "Ganti Shift", active: false },
  { id: 6, name: "Laporan", active: false },
  { id: 7, name: "Settings", active: false },
  { id: 8, name: "Setelan Global", active: false },
  { id: 11, name: "Kitchen", active: false },
  { id: 12, name: "Barista", active: false }
];
