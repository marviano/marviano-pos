'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Plus, Trash2, Upload, Play, Pause, Image as ImageIcon, RefreshCw, FolderOpen, X } from 'lucide-react';

interface SlideshowImage {
  id: string;
  filename: string;
  path: string;
  localPath: string;
  title: string;
  duration: number;
  order: number;
  size: number;
  createdAt: string;
  dataUrl?: string; // Add data URL for preview
}

export default function SlideshowManager() {
  const [slideshowImages, setSlideshowImages] = useState<SlideshowImage[]>([]);
  const [isSlideshowActive, setIsSlideshowActive] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load slideshow images from userData via Electron
  const loadSlideshowImages = async () => {
    setIsLoading(true);
    try {
      if (window.electronAPI?.getSlideshowImages) {
        const result = await window.electronAPI.getSlideshowImages();

        if (result.success && result.images) {
          // Load each image as data URL for preview
          const imagesWithDataUrls = await Promise.all(
            result.images.map(async (image) => {
              try {
                const imageData = await window.electronAPI?.readSlideshowImage?.(image.filename);
                if (imageData?.success && imageData.buffer) {
                  // Convert buffer to base64 data URL
                  const base64 = btoa(
                    new Uint8Array(imageData.buffer).reduce(
                      (data, byte) => data + String.fromCharCode(byte),
                      ''
                    )
                  );
                  return {
                    ...image,
                    dataUrl: `data:${imageData.mimeType};base64,${base64}`
                  };
                }
              } catch (error) {
                console.error('❌ Failed to load image:', image.filename, error);
              }
              return image;
            })
          );

          setSlideshowImages(imagesWithDataUrls);
          console.log('📸 Loaded slideshow images from userData:', imagesWithDataUrls.length);
        } else {
          console.error('❌ Failed to load slideshow images:', result.error);
        }
      } else {
        console.warn('⚠️ Electron API not available, slideshow manager disabled');
      }
    } catch (error) {
      console.error('❌ Error loading slideshow images:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load images on component mount
  useEffect(() => {
    loadSlideshowImages();
  }, []);

  // Handle file upload
  const handleFileUpload = async (files: FileList) => {
    setUploadError(null);
    setUploadSuccess(null);

    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxFileSize = 5 * 1024 * 1024; // 5MB

    const filesArray = Array.from(files);
    let uploadedCount = 0;
    let errorCount = 0;

    for (const file of filesArray) {
      // Validate file type
      if (!validImageTypes.includes(file.type)) {
        setUploadError(`${file.name}: Invalid file type. Only JPG, PNG, WebP, and GIF are supported.`);
        errorCount++;
        continue;
      }

      // Validate file size
      if (file.size > maxFileSize) {
        setUploadError(`${file.name}: File too large. Maximum size is 5MB.`);
        errorCount++;
        continue;
      }

      try {
        // Read file as buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Generate safe filename
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filename = `${timestamp}-${safeName}`;

        // Save via Electron API
        if (window.electronAPI?.saveSlideshowImage) {
          const result = await window.electronAPI.saveSlideshowImage({
            filename,
            buffer
          });

          if (result.success) {
            uploadedCount++;
            console.log('✅ Uploaded:', filename);
          } else {
            setUploadError(result.error || 'Failed to upload image');
            errorCount++;
          }
        }
      } catch (error) {
        console.error('❌ Error uploading file:', file.name, error);
        setUploadError(`Failed to upload ${file.name}`);
        errorCount++;
      }
    }

    // Show success message
    if (uploadedCount > 0) {
      setUploadSuccess(`Successfully uploaded ${uploadedCount} image(s)`);
      // Reload images
      await loadSlideshowImages();

      // Clear success message after 3 seconds
      setTimeout(() => setUploadSuccess(null), 3000);
    }

    if (errorCount > 0) {
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
  };

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Delete image
  const handleDeleteImage = async (filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }

    try {
      if (window.electronAPI?.deleteSlideshowImage) {
        const result = await window.electronAPI.deleteSlideshowImage(filename);

        if (result.success) {
          console.log('🗑️ Deleted:', filename);
          setUploadSuccess('Image deleted successfully');
          await loadSlideshowImages();
          setTimeout(() => setUploadSuccess(null), 2000);
        } else {
          setUploadError(result.error || 'Failed to delete image');
          setTimeout(() => setUploadError(null), 3000);
        }
      }
    } catch (error) {
      console.error('❌ Error deleting image:', error);
      setUploadError('Failed to delete image');
      setTimeout(() => setUploadError(null), 3000);
    }
  };

  // Open slideshow folder in file explorer
  const handleOpenFolder = async () => {
    try {
      if (window.electronAPI?.openSlideshowFolder) {
        const result = await window.electronAPI.openSlideshowFolder();

        if (result.success) {
          console.log('📁 Opened folder:', result.path);
        }
      }
    } catch (error) {
      console.error('❌ Error opening folder:', error);
    }
  };

  const toggleSlideshow = () => {
    setIsSlideshowActive(!isSlideshowActive);
    // Note: Actual slideshow control can be implemented later
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-6 pb-6 pt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-black">Slideshow Manager</h3>
        <div className="flex space-x-2">
          <button
            onClick={loadSlideshowImages}
            disabled={isLoading}
            className="px-3 py-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-black rounded-lg transition-colors flex items-center space-x-1"
            title="Refresh Images"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={handleOpenFolder}
            className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-black rounded-lg transition-colors flex items-center space-x-1"
            title="Open Slideshow Folder"
          >
            <FolderOpen className="w-4 h-4" />
            <span className="text-sm">Open Folder</span>
          </button>
          <button
            onClick={toggleSlideshow}
            className={`px-3 py-1 rounded-lg transition-colors flex items-center space-x-1 ${isSlideshowActive
                ? 'bg-gray-200 hover:bg-gray-300 text-black'
                : 'bg-gray-200 hover:bg-gray-300 text-black'
              }`}
          >
            {isSlideshowActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span className="text-sm">{isSlideshowActive ? 'Active' : 'Paused'}</span>
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {uploadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
          <X className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-800">{uploadError}</p>
          </div>
          <button onClick={() => setUploadError(null)} className="text-red-600 hover:text-red-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {uploadSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-2">
          <div className="flex-1">
            <p className="text-sm text-green-800">{uploadSuccess}</p>
          </div>
          <button onClick={() => setUploadSuccess(null)} className="text-green-600 hover:text-green-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Image Status */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ImageIcon className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-black">Images Folder (userData)</span>
          </div>
          <div className="text-sm text-gray-600">
            {slideshowImages.length > 0 ? (
              <span className="text-green-600">{slideshowImages.length} images found</span>
            ) : (
              <span className="text-orange-600">No images found. Upload some below!</span>
            )}
          </div>
        </div>
        {slideshowImages.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Images will automatically appear in the customer display slideshow
          </div>
        )}
      </div>

      {/* Upload Area */}
      <div
        className={`mb-6 border-2 border-dashed rounded-lg p-6 text-center transition-colors ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <h4 className="text-sm font-medium text-gray-700 mb-1">
          {isDragging ? 'Drop images here' : 'Drag & Drop images or click to upload'}
        </h4>
        <p className="text-xs text-gray-500 mb-3">
          Supports: JPG, PNG, WebP, GIF • Max 5MB per file
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Select Images</span>
        </button>
      </div>

      {/* Image Grid */}
      {slideshowImages.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {slideshowImages.map((image) => (
            <div key={image.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden group hover:shadow-md transition-shadow">
              <div className="relative aspect-video bg-gray-100">
                {image.dataUrl ? (
                  <Image
                    src={image.dataUrl}
                    alt={image.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-12 h-12" />
                  </div>
                )}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleDeleteImage(image.filename)}
                    className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg transition-colors"
                    title="Delete image"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="p-2">
                <h4 className="text-xs font-medium text-gray-800 truncate" title={image.filename}>
                  {image.filename}
                </h4>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-500">{formatFileSize(image.size)}</span>
                  <span className="text-xs text-gray-400">{image.duration}s</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <ImageIcon className="w-16 h-16 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No images uploaded yet</p>
          <p className="text-xs mt-1">Upload images above to get started</p>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Tips:</h4>
        <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
          <li>Images are stored in your computer&apos;s user data folder</li>
          <li>They will persist across app updates</li>
          <li>Click &quot;Open Folder&quot; to add images manually via file explorer</li>
          <li>Recommended size: 1920x1080 (Full HD) for best quality</li>
          <li>Images rotate every 5 seconds on customer display</li>
        </ul>
      </div>
    </div>
  );
}
