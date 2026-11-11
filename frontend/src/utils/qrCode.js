/**
 * Lightweight, zero-dependency QR Code (Byte mode, Version 1-4) SVG generator.
 * Implements ISO/IEC 18004 QR generation in pure JavaScript.
 */

// Galois Field GF(256) tables for Reed-Solomon Error Correction
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(function initGF256() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = val;
    GF256_LOG[val] = i;
    val = (val << 1) ^ (val & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    GF256_EXP[i] = GF256_EXP[i - 255];
  }
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMul(poly[j], GF256_EXP[i]);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function rsEncode(data, ecLength) {
  const gen = rsGeneratorPoly(ecLength);
  const res = new Uint8Array(data.length + ecLength);
  res.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], factor);
      }
    }
  }
  return res.slice(data.length);
}

// QR Table: Version 3-L capacity (max 55 alphanumeric/bytes, 29x29 matrix, EC degree 15)
const QR_SPECS = [
  { version: 1, size: 21, dataBytes: 19, ecBytes: 7 },
  { version: 2, size: 25, dataBytes: 34, ecBytes: 10 },
  { version: 3, size: 29, dataBytes: 55, ecBytes: 15 },
  { version: 4, size: 33, dataBytes: 80, ecBytes: 20 },
  { version: 5, size: 37, dataBytes: 108, ecBytes: 26 }
];

export function generateQrSvg(text, size = 200) {
  const utf8Bytes = new TextEncoder().encode(text);
  
  // Pick smallest fitting version
  let spec = QR_SPECS[0];
  for (const s of QR_SPECS) {
    if (utf8Bytes.length + 3 <= s.dataBytes) {
      spec = s;
      break;
    }
    spec = s;
  }

  const { size: matrixSize, dataBytes, ecBytes } = spec;
  const matrix = Array.from({ length: matrixSize }, () => new Int8Array(matrixSize).fill(-1));
  const reserved = Array.from({ length: matrixSize }, () => new Uint8Array(matrixSize));

  // Finder patterns
  function addFinderPattern(r, c) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const row = r + i;
        const col = c + j;
        if (row >= 0 && row < matrixSize && col >= 0 && col < matrixSize) {
          reserved[row][col] = 1;
          if (
            (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
            (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
            (i >= 2 && i <= 4 && j >= 2 && j <= 4)
          ) {
            matrix[row][col] = 1;
          } else {
            matrix[row][col] = 0;
          }
        }
      }
    }
  }

  addFinderPattern(0, 0);
  addFinderPattern(0, matrixSize - 7);
  addFinderPattern(matrixSize - 7, 0);

  // Timing patterns
  for (let i = 8; i < matrixSize - 8; i++) {
    reserved[6][i] = 1;
    reserved[i][6] = 1;
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Dark module
  reserved[4 * spec.version + 9][8] = 1;
  matrix[4 * spec.version + 9][8] = 1;

  // Build bitstream (Byte mode = 0100)
  const bitStream = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(utf8Bytes.length, 8); // Character count
  for (const b of utf8Bytes) {
    pushBits(b, 8);
  }

  // Terminator
  const totalDataBits = dataBytes * 8;
  const termLen = Math.min(4, totalDataBits - bitStream.length);
  pushBits(0, termLen);

  while (bitStream.length % 8 !== 0) bitStream.push(0);

  const rawData = [];
  for (let i = 0; i < bitStream.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bitStream[i + j];
    rawData.push(byte);
  }

  // Pad bytes
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (rawData.length < dataBytes) {
    rawData.push(padPatterns[padIdx % 2]);
    padIdx++;
  }

  // RS EC encode
  const ec = rsEncode(new Uint8Array(rawData), ecBytes);
  const fullData = [...rawData, ...ec];

  // Interleaved bits to matrix
  const allBits = [];
  for (const byte of fullData) {
    for (let b = 7; b >= 0; b--) {
      allBits.push((byte >> b) & 1);
    }
  }

  let bitIdx = 0;
  let dir = -1;
  let r = matrixSize - 1;
  let c = matrixSize - 1;

  while (c > 0) {
    if (c === 6) c--;
    for (let step = 0; step < matrixSize; step++) {
      const curRow = r;
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const curCol = c - colOffset;
        if (!reserved[curRow][curCol]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Apply mask 0: (row + col) % 2 === 0
          const mask = (curRow + curCol) % 2 === 0;
          matrix[curRow][curCol] = (bit ^ (mask ? 1 : 0));
        }
      }
      r += dir;
    }
    dir = -dir;
    r += dir;
    c -= 2;
  }

  // Format bits (Mask 0, Level L: 0b111011111000100)
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i];
  matrix[8][7] = formatBits[6];
  matrix[8][8] = formatBits[7];
  matrix[7][8] = formatBits[8];
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i];

  for (let i = 0; i < 7; i++) matrix[matrixSize - 1 - i][8] = formatBits[i];
  for (let i = 7; i < 15; i++) matrix[8][matrixSize - 15 + i] = formatBits[i];

  // Generate SVG paths
  const moduleSize = size / (matrixSize + 4);
  let pathData = '';

  for (let row = 0; row < matrixSize; row++) {
    for (let col = 0; col < matrixSize; col++) {
      if (matrix[row][col] === 1) {
        const x = (col + 2) * moduleSize;
        const y = (row + 2) * moduleSize;
        pathData += `M${x.toFixed(1)},${y.toFixed(1)}h${moduleSize.toFixed(1)}v${moduleSize.toFixed(1)}h-${moduleSize.toFixed(1)}z `;
      }
    }
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="#ffffff" rx="12" />
      <path d="${pathData}" fill="#0f172a" />
    </svg>
  `;
}

