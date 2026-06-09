'use strict';
// Resim yükleme: Cloudinary (production) veya local disk (geliştirme).
// Vercel salt-okunur olduğu için production'da Cloudinary şart.
const path = require('path');
const fs = require('fs');

const cloudinary = require('cloudinary').v2;

const CONFIGURED = !!(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}
// CLOUDINARY_URL set ise SDK otomatik okur.

const uploadDir = path.join(__dirname, '../public/uploads');

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'imera-products',
        resource_type: 'image',
        // Web için optimize: max 1400px, otomatik kalite + format (WebP/AVIF)
        transformation: [
          { width: 1400, height: 1400, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// multer memoryStorage'dan gelen file objesini kaydeder, URL döndürür.
async function saveUpload(file) {
  if (!file || !file.buffer) return null;
  if (CONFIGURED) {
    const result = await uploadBufferToCloudinary(file.buffer);
    return result.secure_url;
  }
  // Local geliştirme: disk'e yaz
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const filename = `product-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
  return '/uploads/' + filename;
}

module.exports = { saveUpload, cloudinaryConfigured: CONFIGURED };
