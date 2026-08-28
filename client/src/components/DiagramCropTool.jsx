import React, { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { questionAPI } from '../utils/api';

// Modal for fixing a question's diagram image by hand — drag a rectangle
// over the current image (usually the whole source page, when the AI's own
// crop attempt failed or wasn't confident) and save just that region as the
// new, tightly-cropped diagram.
export default function DiagramCropTool({ questionId, imageUrl, onClose, onSaved }) {
  const imgRef = useRef(null);
  const [box, setBox] = useState(null);      // { x, y, w, h } in rendered-pixel space
  const [dragStart, setDragStart] = useState(null);
  const [saving, setSaving] = useState(false);

  const getRelativePos = (e) => {
    const rect = imgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height),
    };
  };

  const handleStart = (e) => {
    e.preventDefault();
    const pos = getRelativePos(e);
    setDragStart(pos);
    setBox({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handleMove = (e) => {
    if (!dragStart) return;
    const pos = getRelativePos(e);
    setBox({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    });
  };

  const handleEnd = () => setDragStart(null);

  const handleSave = async () => {
    if (!box || box.w < 15 || box.h < 15) {
      return toast.error('Drag a selection over the diagram first');
    }
    const rect = imgRef.current.getBoundingClientRect();
    // Convert rendered-pixel selection to percentages of the actual image —
    // this is what the server's crop logic expects, resolution-independent.
    const percentBox = {
      x_min: (box.x / rect.width) * 100,
      y_min: (box.y / rect.height) * 100,
      x_max: ((box.x + box.w) / rect.width) * 100,
      y_max: ((box.y + box.h) / rect.height) * 100,
    };

    setSaving(true);
    try {
      const res = await questionAPI.manualCrop(questionId, percentBox);
      toast.success('Diagram cropped');
      onSaved?.(res.data.media_url);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Crop failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 20, maxWidth: '90vw',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Fix Diagram Crop</div>
          <div style={{ fontSize: 12.5, color: '#64748B' }}>
            Drag a box over just the diagram — the rest of the page will be cut away.
          </div>
        </div>

        <div
          style={{ position: 'relative', userSelect: 'none', cursor: 'crosshair', maxHeight: '65vh', overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Question source"
            draggable={false}
            style={{ display: 'block', maxWidth: '100%', pointerEvents: 'none' }}
          />
          {box && box.w > 0 && box.h > 0 && (
            <div style={{
              position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
              border: '2px solid #2563EB', background: 'rgba(37,99,235,0.15)', pointerEvents: 'none',
            }} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '9px 16px', borderRadius: 8, border: '1px solid #E2E8F0',
            background: '#fff', color: '#374151', fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !box} style={{
            padding: '9px 18px', borderRadius: 8, border: 'none',
            background: saving || !box ? '#93C5FD' : '#2563EB', color: '#fff',
            fontWeight: 700, cursor: saving || !box ? 'default' : 'pointer',
          }}>{saving ? 'Saving…' : 'Save Crop'}</button>
        </div>
      </div>
    </div>
  );
}
