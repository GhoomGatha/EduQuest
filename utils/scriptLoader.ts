const loadedScripts: { [src: string]: Promise<void> } = {};

/**
 * Dynamically loads a script by adding a <script> tag to the document head.
 * Caches promises to ensure a script is only loaded once.
 * @param src The URL of the script to load.
 * @returns A promise that resolves when the script has loaded, or rejects on error.
 */
export const loadScript = (src: string): Promise<void> => {
  if (loadedScripts[src]) {
    // If script is already loading or has loaded, return the existing promise.
    return loadedScripts[src];
  }

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true; // Load asynchronously
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      // If loading fails, remove from cache to allow retrying.
      delete loadedScripts[src]; 
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(script);
  });

  // Cache the promise
  loadedScripts[src] = promise;
  return promise;
};
