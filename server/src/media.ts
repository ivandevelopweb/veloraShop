import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'
import { fileTypeFromBuffer } from 'file-type'
import multer from 'multer'
import { config } from './config.js'
import { ApiError } from './errors.js'

const maximumFileSize = 10 * 1024 * 1024
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maximumFileSize,
    files: 5,
    fields: 10,
  },
  fileFilter(_request, file, callback) {
    callback(null, allowedMimeTypes.has(file.mimetype))
  },
})

export type UploadedProductImage = {
  publicId: string
  url: string
  width: number
  height: number
}

function getCloudinary() {
  if (!config.cloudinary) {
    throw new ApiError(503, 'Завантаження зображень ще не налаштовано')
  }
  cloudinary.config(config.cloudinary)
  return cloudinary
}

export async function uploadProductImage(file: Express.Multer.File): Promise<UploadedProductImage> {
  const fileType = await fileTypeFromBuffer(file.buffer)
  if (!fileType || !allowedMimeTypes.has(fileType.mime)) {
    throw new ApiError(400, 'Підтримуються лише справжні зображення JPG, PNG або WebP')
  }

  const client = getCloudinary()
  const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        folder: 'velora/products',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error || !result) reject(error ?? new Error('Cloudinary did not return an image'))
        else resolve(result)
      },
    )
    stream.end(file.buffer)
  })

  return {
    publicId: uploaded.public_id,
    url: uploaded.secure_url,
    width: uploaded.width,
    height: uploaded.height,
  }
}

export async function deleteProductImage(publicId: string) {
  const client = getCloudinary()
  await client.uploader.destroy(publicId, { resource_type: 'image', invalidate: true })
}
