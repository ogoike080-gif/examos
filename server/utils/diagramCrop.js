const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DIAGRAMS_DIR = path.join(__dirname, '..', 'uploads', 'diagrams');

// Same logic as the cropDiagram() in routes/import.js / routes/importBatches.js
// / routes/questions.js (repair-diagrams) — kept here too so
// services/autoDiagramCropper.js doesn't need a 4th copy-pasted version.
// Same contract as those: writes the cropped file to uploads/diagrams and
// returns its public URL (e.g. "/uploads/diagrams/xxx.jpg"), or null if the
// box was missing/invalid or the crop otherwise failed. If you're fixing a
// cropping bug, check whether it needs fixing in all four places, since none
// of them currently import from one another.
async function cropDiagram(buffer, box) {
  if (!box || [box.x_min, box.y_min, box.x_max, box.y_max].some(v => typeof v !== 'number')) return null;
  try {
    const image = sharp(buffer);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;

    // 8 percentage points of margin, not a razor-tight box — the AI's own
    // estimate is frequently a little tight around graphs/tables (axis
    // labels, tick marks, and table borders sit right at the edge), and a
    // diagram that's clipped is unrecoverable, whereas a bit of extra
    // whitespace or neighbouring text around it is harmless. Bias generous.
    const pad = 8;
    const xMin = Math.max(0, box.x_min - pad);
    const yMin = Math.max(0, box.y_min - pad);
    const xMax = Math.min(100, box.x_max + pad);
    const yMax = Math.min(100, box.y_max + pad);
    if (xMax <= xMin || yMax <= yMin) return null;

    const left = Math.round((xMin / 100) * meta.width);
    const top = Math.round((yMin / 100) * meta.height);
    // Clamp width/height so rounding never pushes the extract box past the
    // actual image bounds (sharp throws on an out-of-bounds extract).
    const width = Math.min(Math.round(((xMax - xMin) / 100) * meta.width), meta.width - left);
    const height = Math.min(Math.round(((yMax - yMin) / 100) * meta.height), meta.height - top);
    if (width < 20 || height < 20) return null; // suspiciously tiny — box was probably bad

    fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
    const filename = `${uuidv4()}.jpg`;
    await sharp(buffer).extract({ left, top, width, height }).jpeg({ quality: 88 }).toFile(path.join(DIAGRAMS_DIR, filename));
    return `/uploads/diagrams/${filename}`;
  } catch (err) {
    console.error('cropDiagram failed:', err.message);
    return null;
  }
}

module.exports = { cropDiagram };
