const HEIC_RE = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /^image\/hei[cf]$/i;
const HEIC2ANY_CDN = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';

let heicLoaderPromise = null;

export const isHeicFile = (file) => {
  const name = file?.name || '';
  const type = file?.type || '';
  return HEIC_RE.test(name) || HEIC_MIME_RE.test(type);
};

const loadHeic2Any = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ไม่สามารถแปลง HEIC บนสภาพแวดล้อมนี้ได้'));
  }
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (heicLoaderPromise) return heicLoaderPromise;

  heicLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HEIC2ANY_CDN;
    script.async = true;
    script.onload = () => {
      if (window.heic2any) resolve(window.heic2any);
      else reject(new Error('โหลดตัวแปลง HEIC ไม่สำเร็จ'));
    };
    script.onerror = () => reject(new Error('โหลดตัวแปลง HEIC ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต'));
    document.head.appendChild(script);
  });

  return heicLoaderPromise;
};

const jpegName = (name = 'image') => {
  if (HEIC_RE.test(name)) return name.replace(HEIC_RE, '.jpg');
  return `${name}.jpg`;
};

export const convertHeicToJpeg = async (file) => {
  if (!isHeicFile(file)) return file;

  const heic2any = await loadHeic2Any();
  const output = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.92,
  });
  const blob = Array.isArray(output) ? output[0] : output;

  return new File([blob], jpegName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified || Date.now(),
  });
};

export const convertHeicFilesToJpeg = async (files) => {
  const list = Array.from(files || []);
  const converted = [];
  let convertedCount = 0;

  for (const file of list) {
    if (isHeicFile(file)) convertedCount += 1;
    converted.push(await convertHeicToJpeg(file));
  }

  return { files: converted, convertedCount };
};
