// Local composition/colour similarity is a review hint, never a role identity.
// Uses already decoded gallery images; no upload, model, extra image requests or background scan.
export function imageDescriptor(pixels) {
  if (!pixels || pixels.length !== 16 * 16 * 4) throw new Error("Invalid thumbnail pixels");
  const gray = [], colors = Array(24).fill(0);
  let mean = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luminance = (pixels[i] * .299 + pixels[i+1] * .587 + pixels[i+2] * .114) / 255;
    gray.push(luminance); mean += luminance;
    for (let c=0;c<3;c++) colors[c*8+Math.min(7, Math.floor(pixels[i+c]/32))] += 1 / 256;
  }
  mean /= 256;
  const variance = Math.sqrt(gray.reduce((s,x) => s+(x-mean)**2,0)/256);
  return { shape: gray.map(x => (x-mean)/Math.max(.1,variance)), colors, variance };
}

export function visualSimilarity(a, b) {
  if (!a || !b || a.variance < .025 || b.variance < .025) return 0;
  const structure = Math.max(0, 1 - Math.sqrt(a.shape.reduce((s,x,i) => s+(x-b.shape[i])**2,0)/256)/2);
  const color = a.colors.reduce((s,x,i) => s+Math.min(x,b.colors[i]),0)/3;
  return Math.max(0, Math.min(1, structure*.7+color*.3));
}

export function descriptorFromImage(image) {
  if (!image?.complete || !image.naturalWidth) return null;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, 16, 16);
  return imageDescriptor(context.getImageData(0, 0, 16, 16).data);
}
