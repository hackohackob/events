/**
 * Ogg Opus (de)muxing.
 *
 * Zello carries voice as **bare Opus packets with no container** — nothing can
 * play those, and nothing can produce them without a container either. Rather
 * than pull in libopus/wasm just to move bytes around, this module wraps the
 * untouched packets into an Ogg Opus stream (playable everywhere) and unwraps
 * an Ogg Opus stream back into packets for transmission. The Opus payload is
 * never decoded or re-encoded, so a round trip is bit-exact.
 */

/**
 * Ogg's CRC-32 is not the common one: polynomial 0x04c11db7, MSB-first, init 0,
 * **no** input/output reflection and no final XOR. Using a stock CRC-32 here
 * produces a file every decoder rejects.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(buf: Buffer): number {
  let crc = 0;
  for (const byte of buf) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc >>> 0;
}

/** Zello's 4-byte `codec_header`, which is not an OpusHead. */
export interface ZelloCodecHeader {
  /** Encoder input rate — uint16 **little-endian** in bytes 0–1. */
  sampleRate: number;
  framesPerPacket: number;
  frameSizeMs: number;
}

export function parseCodecHeader(base64Header: string): ZelloCodecHeader {
  const buf = Buffer.from(base64Header, "base64");
  if (buf.length < 4) return { sampleRate: 16000, framesPerPacket: 1, frameSizeMs: 60 };
  return {
    sampleRate: buf.readUInt16LE(0),
    framesPerPacket: buf.readUInt8(2) || 1,
    frameSizeMs: buf.readUInt8(3) || 60,
  };
}

export function buildCodecHeader(header: ZelloCodecHeader): string {
  const buf = Buffer.alloc(4);
  buf.writeUInt16LE(header.sampleRate, 0);
  buf.writeUInt8(header.framesPerPacket, 2);
  buf.writeUInt8(header.frameSizeMs, 3);
  return buf.toString("base64");
}

/** Lacing: lengths split into 255-byte runs; an exact multiple needs a trailing 0. */
function laceSegments(length: number): number[] {
  const segments: number[] = [];
  let remaining = length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  return segments;
}

function buildPage(input: {
  headerType: number;
  granulePosition: bigint;
  serial: number;
  sequence: number;
  segments: number[];
  payload: Buffer;
}): Buffer {
  const header = Buffer.alloc(27 + input.segments.length);
  header.write("OggS", 0, "ascii");
  header.writeUInt8(0, 4); // stream structure version
  header.writeUInt8(input.headerType, 5);
  header.writeBigInt64LE(input.granulePosition, 6);
  header.writeUInt32LE(input.serial, 14);
  header.writeUInt32LE(input.sequence, 18);
  header.writeUInt32LE(0, 22); // CRC placeholder — checksummed with zeroes in place
  header.writeUInt8(input.segments.length, 26);
  for (let i = 0; i < input.segments.length; i++) header.writeUInt8(input.segments[i]!, 27 + i);

  const page = Buffer.concat([header, input.payload]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function opusHead(channels: number, sampleRate: number): Buffer {
  const buf = Buffer.alloc(19);
  buf.write("OpusHead", 0, "ascii");
  buf.writeUInt8(1, 8); // version
  buf.writeUInt8(channels, 9);
  buf.writeUInt16LE(0, 10); // pre-skip — Zello never sends one
  buf.writeUInt32LE(sampleRate, 12);
  buf.writeInt16LE(0, 16); // output gain
  buf.writeUInt8(0, 18); // channel mapping family
  return buf;
}

function opusTags(vendor = "events-ptt"): Buffer {
  const vendorBuf = Buffer.from(vendor, "utf8");
  const buf = Buffer.alloc(8 + 4 + vendorBuf.length + 4);
  buf.write("OpusTags", 0, "ascii");
  buf.writeUInt32LE(vendorBuf.length, 8);
  vendorBuf.copy(buf, 12);
  buf.writeUInt32LE(0, 12 + vendorBuf.length); // zero user comments
  return buf;
}

/**
 * Wrap raw Opus packets into an Ogg Opus file.
 *
 * Granule positions are **always counted at 48 kHz** regardless of the encoder's
 * input rate — getting this wrong yields a file that plays at the wrong speed.
 */
export function packOpusToOgg(packets: Buffer[], header: ZelloCodecHeader, serial = 0xfeed0001): Buffer {
  const samplesPerPacket = header.framesPerPacket * header.frameSizeMs * 48;
  const pages: Buffer[] = [];
  let sequence = 0;

  const head = opusHead(1, header.sampleRate);
  pages.push(
    buildPage({
      headerType: 0x02, // beginning of stream
      granulePosition: 0n,
      serial,
      sequence: sequence++,
      segments: laceSegments(head.length),
      payload: head,
    }),
  );

  const tags = opusTags();
  pages.push(
    buildPage({
      headerType: 0x00,
      granulePosition: 0n,
      serial,
      sequence: sequence++,
      segments: laceSegments(tags.length),
      payload: tags,
    }),
  );

  let granule = 0n;
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i]!;
    granule += BigInt(samplesPerPacket);
    pages.push(
      buildPage({
        headerType: i === packets.length - 1 ? 0x04 : 0x00, // end of stream on the last
        granulePosition: granule,
        serial,
        sequence: sequence++,
        segments: laceSegments(packet.length),
        payload: packet,
      }),
    );
  }

  return Buffer.concat(pages);
}

/**
 * Pull the Opus packets back out of an Ogg Opus file, dropping the two header
 * packets. Packets that span pages are reassembled via the lacing rules.
 */
export function unpackOggOpus(ogg: Buffer): { packets: Buffer[]; sampleRate: number; channels: number } {
  const packets: Buffer[] = [];
  let pending: Buffer[] = [];
  let sampleRate = 48000;
  let channels = 1;

  let offset = 0;
  while (offset + 27 <= ogg.length) {
    if (ogg.toString("ascii", offset, offset + 4) !== "OggS") {
      // Resynchronise rather than give up: a stray byte shouldn't lose the file.
      const next = ogg.indexOf("OggS", offset + 1, "ascii");
      if (next === -1) break;
      offset = next;
      continue;
    }
    const segmentCount = ogg.readUInt8(offset + 26);
    const tableStart = offset + 27;
    const dataStart = tableStart + segmentCount;
    if (dataStart > ogg.length) break;

    let cursor = dataStart;
    for (let i = 0; i < segmentCount; i++) {
      const size = ogg.readUInt8(tableStart + i);
      if (cursor + size > ogg.length) return { packets, sampleRate, channels };
      pending.push(ogg.subarray(cursor, cursor + size));
      cursor += size;
      if (size < 255) {
        const packet = Buffer.concat(pending);
        pending = [];
        if (packet.length >= 8 && packet.toString("ascii", 0, 8) === "OpusHead") {
          channels = packet.readUInt8(9);
          sampleRate = packet.readUInt32LE(12);
        } else if (packet.length >= 8 && packet.toString("ascii", 0, 8) === "OpusTags") {
          // metadata only
        } else if (packet.length > 0) {
          packets.push(packet);
        }
      }
    }
    offset = cursor;
  }

  return { packets, sampleRate, channels };
}
