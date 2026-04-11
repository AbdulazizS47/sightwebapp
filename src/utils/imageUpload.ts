const MAX_UPLOAD_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_BYTES = 650 * 1024;
export const MAX_UPLOAD_IMAGE_DIMENSION = 1200;

const OUTPUT_IMAGE_TYPES = ['image/jpeg'] as const;
const OUTPUT_EXTENSIONS: Record<(typeof OUTPUT_IMAGE_TYPES)[number], string> = {
  'image/jpeg': '.jpg',
};

export const UPLOAD_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const UPLOAD_ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export const getImageUploadError = (file: File) => {
  const type = String(file.type || '').toLowerCase().trim();
  const ext = String(file.name || '')
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0];

  if (!UPLOAD_ALLOWED_IMAGE_TYPES.has(type) && !(ext && UPLOAD_ALLOWED_IMAGE_EXTENSIONS.has(ext))) {
    return 'Unsupported format. Please use JPG, PNG, or WEBP.';
  }

  if (file.size > MAX_UPLOAD_SOURCE_IMAGE_BYTES) {
    return 'Original image too large. Please choose an image under 15MB.';
  }

  return '';
};

const loadImageFromFile = async (file: File) => {
  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to read image'));
      img.src = url;
    });

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

const getScaledSize = (width: number, height: number, maxDimension: number) => {
  const maxSide = Math.max(width, height);
  if (maxSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const buildOutputFile = (blob: Blob, originalName: string, outputType: (typeof OUTPUT_IMAGE_TYPES)[number]) => {
  const baseName = originalName.replace(/\.[a-z0-9]+$/i, '') || 'menu-image';
  const nextName = `${baseName}${OUTPUT_EXTENSIONS[outputType]}`;
  return new File([blob], nextName, {
    type: outputType,
    lastModified: Date.now(),
  });
};

export const prepareImageUpload = async (file: File) => {
  if (typeof document === 'undefined') {
    return file;
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Unsupported image format');
  }

  const image = await loadImageFromFile(file);
  const initialSize = getScaledSize(image.naturalWidth || image.width, image.naturalHeight || image.height, MAX_UPLOAD_IMAGE_DIMENSION);

  if (
    file.type === 'image/jpeg' &&
    initialSize.width === (image.naturalWidth || image.width) &&
    initialSize.height === (image.naturalHeight || image.height) &&
    file.size <= MAX_UPLOAD_IMAGE_BYTES
  ) {
    return file;
  }

  let bestBlob: Blob | null = null;
  let bestType: (typeof OUTPUT_IMAGE_TYPES)[number] = 'image/webp';
  let width = initialSize.width;
  let height = initialSize.height;

  for (let pass = 0; pass < 5; pass += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Image processing is not available in this browser');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const outputType of OUTPUT_IMAGE_TYPES) {
      for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56]) {
        const blob = await canvasToBlob(canvas, outputType, quality);
        if (!blob) continue;

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestType = outputType;
        }

        if (blob.size <= MAX_UPLOAD_IMAGE_BYTES) {
          return buildOutputFile(blob, file.name, outputType);
        }
      }
    }

    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
  }

  if (bestBlob && bestBlob.size <= MAX_UPLOAD_IMAGE_BYTES) {
    return buildOutputFile(bestBlob, file.name, bestType);
  }

  throw new Error('Image is still too large after resizing. Please choose a smaller image.');
};
