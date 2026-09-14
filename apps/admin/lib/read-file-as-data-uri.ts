/**
 * Wraps FileReader.readAsDataURL in a Promise. Used by AppLogoField to
 * convert a picked image into the base64 data URI the backend stores.
 */
export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
