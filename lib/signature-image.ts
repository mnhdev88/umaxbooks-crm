/**
 * Shared helpers for the "upload a signature image" option on the two signature
 * pads — the rep's pad in the new-contract modal and the client's pad on the
 * public signing page.
 *
 * The upload is painted straight onto the existing pad canvas, so everything
 * downstream (`canvas.toDataURL()`, the stored data URL, the PDF) is identical
 * whether the signature was drawn or uploaded.
 */

export const SIGNATURE_ACCEPT = 'image/png,image/jpeg,image/webp'

const MAX_BYTES = 5 * 1024 * 1024

/** Read a picked file into a decoded image, with user-facing errors. */
export function loadSignatureFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Please choose an image file (PNG, JPG or WEBP).'))
    }
    if (file.size > MAX_BYTES) {
      return reject(new Error('That image is too large — please use one under 5 MB.'))
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onload  = () => resolve(img)
      img.onerror = () => reject(new Error("That image couldn't be opened."))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Clear the pad and paint the image scaled to fit, centred. Coordinates are CSS
 * pixels — both pads leave a transform in place that makes 1 unit = 1 CSS pixel.
 * The image is used as-is: a photo of a signature on paper keeps its paper.
 */
export function paintSignature(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
) {
  const pad = 6
  const scale = Math.min(
    (cssWidth  - pad * 2) / img.width,
    (cssHeight - pad * 2) / img.height,
  )
  const w = img.width  * scale
  const h = img.height * scale
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.drawImage(img, (cssWidth - w) / 2, (cssHeight - h) / 2, w, h)
}
