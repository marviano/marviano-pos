'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Category {
  jenis: string;
  active: boolean;
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
  
  return (
    <div className="w-48 bg-blue-100 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-blue-200">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Kategori</h3>
          <button className="p-1 text-gray-600 hover:text-gray-800">
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

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
          validCategories.map((category, index) => (
          <button
            key={index}
            onClick={() => onCategorySelect(category.jenis)}
            disabled={isLoadingCategories}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
              selectedCategory === category.jenis
                ? 'bg-blue-200 text-blue-800'
                : 'text-gray-700 hover:bg-blue-50'
            } ${isLoadingCategories ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="text-xs">{category.jenis}</span>
            {selectedCategory === category.jenis && (
              <ChevronRight className="w-4 h-4 text-blue-600" />
            )}
          </button>
          ))
        )}
      </div>

    </div>
  );
}
