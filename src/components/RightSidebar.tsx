'use client';

import { ChevronRight } from 'lucide-react';

interface Category {
  jenis: string;
  active: boolean;
  productType?: 'drinks' | 'bakery' | 'foods' | 'packages';
}

interface RightSidebarProps {
  categories: Category[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  isLoadingCategories?: boolean;
}

export default function RightSidebar({ categories, selectedCategory, onCategorySelect, isLoadingCategories = false }: RightSidebarProps) {
  // Filter out blank/null categories
  const validCategories = categories.filter(cat => cat.jenis && cat.jenis.trim() !== '');

  // Group categories by product type
  const drinksCategories = validCategories.filter(cat => cat.productType === 'drinks');
  const bakeryCategories = validCategories.filter(cat => cat.productType === 'bakery');
  const foodsCategories = validCategories.filter(cat => cat.productType === 'foods');
  const packagesCategories = validCategories.filter(cat => cat.productType === 'packages');

  return (
    <div className="w-48 bg-blue-100 flex flex-col h-full">
      {/* Category List */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Loading Overlay - Only show when switching categories, not initial load */}
        {isLoadingCategories && validCategories.length > 0 && (
          <div className="absolute inset-0 bg-blue-100/80 z-10 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
              <p className="text-gray-600 text-sm">Loading...</p>
            </div>
          </div>
        )}

        {/* Show loading message only when no categories are loaded yet */}
        {validCategories.length === 0 && isLoadingCategories ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
              <p className="text-gray-600 text-sm">Loading categories...</p>
            </div>
          </div>
        ) : validCategories.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-gray-600 text-sm">No categories available</p>
          </div>
        ) : (
          <>
            {/* Drinks Section */}
            {drinksCategories.length > 0 && (
              <>
                <div className="px-4 py-2 bg-blue-200 border-b border-blue-300">
                  <h4 className="text-xs font-semibold text-blue-900">🥤 DRINKS</h4>
                </div>
                {drinksCategories.map((category, index) => (
                  <button
                    key={`drinks-${index}`}
                    onClick={() => onCategorySelect(category.jenis)}
                    disabled={isLoadingCategories}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${selectedCategory === category.jenis
                        ? 'bg-green-200 text-green-900 font-medium'
                        : 'text-gray-700 hover:bg-blue-50'
                      } ${isLoadingCategories ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-xs">{category.jenis}</span>
                    {selectedCategory === category.jenis && (
                      <ChevronRight className="w-4 h-4 text-green-700" />
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Bakery Section */}
            {bakeryCategories.length > 0 && (
              <>
                <div className="px-4 py-2 bg-blue-200 border-b border-blue-300 mt-2">
                  <h4 className="text-xs font-semibold text-blue-900">🥖 BAKERY</h4>
                </div>
                {bakeryCategories.map((category, index) => (
                  <button
                    key={`bakery-${index}`}
                    onClick={() => onCategorySelect(category.jenis)}
                    disabled={isLoadingCategories}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${selectedCategory === category.jenis
                        ? 'bg-green-200 text-green-900 font-medium'
                        : 'text-gray-700 hover:bg-blue-50'
                      } ${isLoadingCategories ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-xs">{category.jenis}</span>
                    {selectedCategory === category.jenis && (
                      <ChevronRight className="w-4 h-4 text-green-700" />
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Foods Section */}
            {foodsCategories.length > 0 && (
              <>
                <div className="px-4 py-2 bg-blue-200 border-b border-blue-300 mt-2">
                  <h4 className="text-xs font-semibold text-blue-900">🍽️ FOODS</h4>
                </div>
                {foodsCategories.map((category, index) => (
                  <button
                    key={`foods-${index}`}
                    onClick={() => onCategorySelect(category.jenis)}
                    disabled={isLoadingCategories}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${selectedCategory === category.jenis
                        ? 'bg-green-200 text-green-900 font-medium'
                        : 'text-gray-700 hover:bg-blue-50'
                      } ${isLoadingCategories ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-xs">{category.jenis}</span>
                    {selectedCategory === category.jenis && (
                      <ChevronRight className="w-4 h-4 text-green-700" />
                    )}
                  </button>
                ))}
              </>
            )}

            {/* Packages Section */}
            {packagesCategories.length > 0 && (
              <>
                <div className="px-4 py-2 bg-blue-200 border-b border-blue-300 mt-2">
                  <h4 className="text-xs font-semibold text-blue-900">📦 PACKAGES</h4>
                </div>
                {packagesCategories.map((category, index) => (
                  <button
                    key={`packages-${index}`}
                    onClick={() => onCategorySelect(category.jenis)}
                    disabled={isLoadingCategories}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${selectedCategory === category.jenis
                        ? 'bg-green-200 text-green-900 font-medium'
                        : 'text-gray-700 hover:bg-blue-50'
                      } ${isLoadingCategories ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-xs">{category.jenis}</span>
                    {selectedCategory === category.jenis && (
                      <ChevronRight className="w-4 h-4 text-green-700" />
                    )}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>

    </div>
  );
}
