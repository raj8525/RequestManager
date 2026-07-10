const PNG_SIGNATURE = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

const JPEG_SIGNATURE = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

const WEBP_SIGNATURE = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);

function imageFile(
  signature: Uint8Array,
  name: string,
  type: string,
  size?: number,
): File {
  const signatureBuffer = new Uint8Array(signature.byteLength);
  signatureBuffer.set(signature);
  if (size === undefined || size <= signature.byteLength) {
    return new File([signatureBuffer.buffer], name, { type });
  }
  const padding = new Uint8Array(size - signature.byteLength);
  return new File(
    [signatureBuffer.buffer, padding.buffer],
    name,
    { type },
  );
}

export function pngFile(
  name = "screenshot.png",
  size?: number,
  type = "image/png",
): File {
  return imageFile(PNG_SIGNATURE, name, type, size);
}

export function jpegFile(
  name = "screenshot.jpg",
  size?: number,
  type = "image/jpeg",
): File {
  return imageFile(JPEG_SIGNATURE, name, type, size);
}

export function webpFile(
  name = "screenshot.webp",
  size?: number,
  type = "image/webp",
): File {
  return imageFile(WEBP_SIGNATURE, name, type, size);
}

export function fakePngSvg(name = "spoofed.png"): File {
  return new File(
    ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    name,
    { type: "image/png" },
  );
}
