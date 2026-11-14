'use strict';

// Read a PCM WAV header. Returns null when the buffer is not a readable WAV.

function findChunk(buf, id, from) {
  let o = from;
  while (o + 8 <= buf.length) {
    const name = buf.slice(o, o + 4).toString('ascii');
    const size = buf.readUInt32LE(o + 4);
    if (name === id) return { offset: o, size, data: o + 8 };
    o += 8 + size + (size % 2);
  }
  return null;
}

function wavInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44) return null;
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buf.slice(8, 12).toString('ascii') !== 'WAVE') return null;
  const fmt = findChunk(buf, 'fmt ', 12);
  const data = findChunk(buf, 'data', 12);
  if (!fmt || !data || fmt.size < 16) return null;
  const audioFormat = buf.readUInt16LE(fmt.data);
  const channels = buf.readUInt16LE(fmt.data + 2);
  const sampleRate = buf.readUInt32LE(fmt.data + 4);
  const bitsPerSample = buf.readUInt16LE(fmt.data + 14);
  if (!(channels > 0) || !(sampleRate > 0) || !(bitsPerSample > 0)) return null;
  const bytesPerFrame = channels * (bitsPerSample / 8);
  if (!Number.isInteger(bytesPerFrame) || bytesPerFrame <= 0) return null;
  const available = Math.min(data.size, buf.length - data.data);
  if (available < data.size) return null;
  if (available % bytesPerFrame !== 0) return null;
  const samples = available / bytesPerFrame;
  return {
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    dataBytes: available,
    samples,
    durationSeconds: samples / sampleRate,
  };
}

module.exports = { wavInfo };
