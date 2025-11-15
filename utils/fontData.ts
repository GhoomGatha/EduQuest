// This file provides functions to dynamically fetch and cache fonts for PDF generation.
// This approach avoids storing large base64 strings in the source code and ensures
// the correct, full font file is used, fixing encoding errors.

// Helper function to fetch a font from a URL and convert it to a base64 string.
const fetchFontAsBase64 = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch font: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // The result is a Data URL: "data:font/ttf;base64,xxxxxx...".
        // We need to extract just the base64 part after the comma.
        const base64data = (reader.result as string).split(',')[1];
        if (base64data) {
          resolve(base64data);
        } else {
          reject(new Error('Failed to read font data as base64.'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`Error fetching or converting font from ${url}:`, error);
    return ''; // Return an empty string on failure.
  }
};

// Use a reliable CDN (jsDelivr) to fetch fonts directly from the Google Fonts GitHub repo.
// This is more robust than using raw.githubusercontent.com, which can be unreliable or blocked.
const NOTO_SANS_BENGALI_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/notosansbengali/NotoSansBengali-Regular.ttf';
const NOTO_SANS_DEVANAGARI_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/notosansdevanagari/NotoSansDevanagari-Regular.ttf';
const NOTO_SANS_KANNADA_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/notosanskannada/NotoSansKannada-Regular.ttf';



// In-memory cache to avoid re-fetching the font on every PDF export.
let bengaliFontCache: string | null = null;
let devanagariFontCache: string | null = null;
let kannadaFontCache: string | null = null;

/**
 * Fetches the Noto Sans Bengali font, converts it to base64, and caches it.
 * @returns A promise that resolves to the base64 encoded font data.
 */
export const getBengaliFontBase64 = async (): Promise<string> => {
    if (bengaliFontCache) {
        return bengaliFontCache;
    }
    const fontData = await fetchFontAsBase64(NOTO_SANS_BENGALI_URL);
    if (fontData) {
        bengaliFontCache = fontData;
    }
    return fontData;
};

/**
 * Fetches the Noto Sans Devanagari font, converts it to base64, and caches it.
 * @returns A promise that resolves to the base64 encoded font data.
 */
export const getDevanagariFontBase64 = async (): Promise<string> => {
    if (devanagariFontCache) {
        return devanagariFontCache;
    }
    const fontData = await fetchFontAsBase64(NOTO_SANS_DEVANAGARI_URL);
    if (fontData) {
        devanagariFontCache = fontData;
    }
    return fontData;
};

/**
 * Fetches the Noto Sans Kannada font, converts it to base64, and caches it.
 * @returns A promise that resolves to the base64 encoded font data.
 */
export const getKannadaFontBase64 = async (): Promise<string> => {
    if (kannadaFontCache) {
        return kannadaFontCache;
    }
    const fontData = await fetchFontAsBase64(NOTO_SANS_KANNADA_URL);
    if (fontData) {
        kannadaFontCache = fontData;
    }
    return fontData;
};