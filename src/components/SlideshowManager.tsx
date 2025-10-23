'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit, Play, Pause, Image, RefreshCw } from 'lucide-react';

interface SlideshowItem {
  id: string;
  title: string;
  description: string;
  image: string;
  duration: number; // in seconds
}

interface SlideshowImage {
  id: string;
  filename: string;
  path: string;
  title: string;
  duration: number;
  order: number;
}

export default function SlideshowManager() {
  const [slideshowItems, setSlideshowItems] = useState<SlideshowItem[]>([
    {
      id: '1',
      title: 'SERBU 10.10',
      description: '10.10 Pudding Sundae ONLY Rp 10.000',
      image: '/images/promotion-1.jpg',
      duration: 5
    },
    {
      id: '2',
      title: 'MOMOYO Special',
      description: 'Fresh Lemon Drinks with Real Fruit',
      image: '/images/promotion-2.jpg',
      duration: 5
    },
    {
      id: '3',
      title: 'Ice Cream Delight',
      description: 'Premium Ice Cream Cones & Sundaes',
      image: '/images/promotion-3.jpg',
      duration: 5
    }
  ]);

  const [slideshowImages, setSlideshowImages] = useState<SlideshowImage[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<SlideshowItem | null>(null);
  const [isSlideshowActive, setIsSlideshowActive] = useState(true);

  // Send slideshow updates to customer display
  const sendSlideshowUpdate = (items: SlideshowItem[]) => {
    if (window.electronAPI && window.electronAPI.updateCustomerSlideshow) {
      window.electronAPI.updateCustomerSlideshow({ slideshowItems: items });
    }
  };

  // Load slideshow images from API
  const loadSlideshowImages = async () => {
    try {
      const response = await fetch('/api/slideshow/images');
      const data = await response.json();
      
      if (data.success) {
        setSlideshowImages(data.images);
        console.log('📸 Loaded slideshow images:', data.images.length);
      }
    } catch (error) {
      console.error('❌ Failed to load slideshow images:', error);
    }
  };

  // Update slideshow when items change
  useEffect(() => {
    sendSlideshowUpdate(slideshowItems);
  }, [slideshowItems]);

  // Load images on component mount
  useEffect(() => {
    loadSlideshowImages();
  }, []);

  const addNewSlide = () => {
    const newItem: SlideshowItem = {
      id: Date.now().toString(),
      title: 'New Promotion',
      description: 'Enter description here',
      image: '/images/default-promotion.jpg',
      duration: 5
    };
    setSlideshowItems([...slideshowItems, newItem]);
    setEditingItem(newItem);
    setIsEditing(true);
  };

  const editSlide = (item: SlideshowItem) => {
    setEditingItem(item);
    setIsEditing(true);
  };

  const deleteSlide = (id: string) => {
    setSlideshowItems(slideshowItems.filter(item => item.id !== id));
  };

  const saveSlide = (updatedItem: SlideshowItem) => {
    setSlideshowItems(slideshowItems.map(item => 
      item.id === updatedItem.id ? updatedItem : item
    ));
    setIsEditing(false);
    setEditingItem(null);
  };

  const toggleSlideshow = () => {
    setIsSlideshowActive(!isSlideshowActive);
    // Send slideshow state to customer display
    if (window.electronAPI && window.electronAPI.updateCustomerSlideshow) {
      window.electronAPI.updateCustomerSlideshow({ 
        slideshowItems: isSlideshowActive ? [] : slideshowItems,
        isActive: !isSlideshowActive
      });
    }
  };

  if (isEditing && editingItem) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Edit Slideshow Item</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title
            </label>
            <input
              type="text"
              value={editingItem.title}
              onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              type="text"
              value={editingItem.description}
              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (seconds)
            </label>
            <input
              type="number"
              min="3"
              max="30"
              value={editingItem.duration}
              onChange={(e) => setEditingItem({ ...editingItem, duration: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={() => saveSlide(editingItem)}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setEditingItem(null);
              }}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Slideshow Manager</h3>
        <div className="flex space-x-2">
          <button
            onClick={loadSlideshowImages}
            className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center space-x-1"
            title="Refresh Images"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={toggleSlideshow}
            className={`px-3 py-1 rounded-lg transition-colors flex items-center space-x-1 ${
              isSlideshowActive 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isSlideshowActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span className="text-sm">{isSlideshowActive ? 'Pause' : 'Play'}</span>
          </button>
          <button
            onClick={addNewSlide}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center space-x-1"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm">Add Slide</span>
          </button>
        </div>
      </div>

      {/* Image Status */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Image className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium">Images Folder</span>
          </div>
          <div className="text-sm text-gray-600">
            {slideshowImages.length > 0 ? (
              <span className="text-green-600">{slideshowImages.length} images found</span>
            ) : (
              <span className="text-orange-600">No images found in /public/images/slideshow/</span>
            )}
          </div>
        </div>
        {slideshowImages.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Images will automatically appear in the customer display slideshow
          </div>
        )}
      </div>
      
      <div className="space-y-3">
        {slideshowItems.map((item, index) => (
          <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">{index + 1}</span>
              </div>
              <div>
                <h4 className="font-medium text-gray-800">{item.title}</h4>
                <p className="text-sm text-gray-600">{item.description}</p>
                <p className="text-xs text-gray-500">{item.duration}s duration</p>
              </div>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => editSlide(item)}
                className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                title="Edit"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                onClick={() => deleteSlide(item.id)}
                className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        
        {slideshowItems.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>No slideshow items. Click "Add Slide" to create one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
