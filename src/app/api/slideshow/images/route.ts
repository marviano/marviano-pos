import { NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  try {
    const slideshowDir = join(process.cwd(), 'public', 'images', 'slideshow');
    
    // Read all files in the slideshow directory
    const files = await readdir(slideshowDir);
    
    // Filter for image files only
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const imageFiles = files.filter(file => {
      const ext = file.toLowerCase().substring(file.lastIndexOf('.'));
      return imageExtensions.includes(ext);
    });
    
    // Sort files alphabetically for consistent order
    imageFiles.sort();
    
    // Create image objects with metadata
    const images = imageFiles.map((file, index) => ({
      id: `slide-${index + 1}`,
      filename: file,
      path: `/images/slideshow/${file}`,
      title: file.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      duration: 5, // Default 5 seconds per image
      order: index + 1
    }));
    
    return NextResponse.json({
      success: true,
      images,
      count: images.length
    });
    
  } catch (error) {
    console.error('Error reading slideshow images:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to read slideshow images',
      images: [],
      count: 0
    }, { status: 500 });
  }
}
