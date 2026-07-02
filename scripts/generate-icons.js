const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const SRC = path.join(PUBLIC, 'icono-original.png');

const SIZES = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-192.png', size: 192 },
  { name: 'icon-maskable-512.png', size: 512 },
  { name: 'badge.png', size: 96 },
  { name: 'favicon.png', size: 48 },
];

async function main() {
  for (const { name, size } of SIZES) {
    const out = path.join(PUBLIC, name);
    await sharp(SRC)
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(out);
    console.log(`Generated ${name} (${size}x${size})`);
  }
  console.log('Done!');
}

main().catch(console.error);
