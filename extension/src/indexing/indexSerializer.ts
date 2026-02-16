/**
 * Binary serialization for index data
 *
 * Provides efficient binary format for:
 * - BloomFilter state (Uint8Array → Buffer)
 * - Symbol index metadata
 */

import * as fs from 'fs/promises';
import { BloomFilter } from '../shared/dataStructures/bloomFilter';

/**
 * Serialized BloomFilter format:
 * - 4 bytes: size (uint32)
 * - 4 bytes: hashCount (uint32)
 * - 4 bytes: addedCount (uint32)
 * - N bytes: bitArray
 */
export async function saveBloomFilter(filter: BloomFilter, filePath: string): Promise<void> {
    const serialized = filter.serialize();
    const headerSize = 12; // 3 x uint32
    const buffer = Buffer.alloc(headerSize + serialized.bitArray.length);

    // Write header
    buffer.writeUInt32LE(serialized.size, 0);
    buffer.writeUInt32LE(serialized.hashCount, 4);
    buffer.writeUInt32LE(serialized.addedCount, 8);

    // Write bitArray
    for (let i = 0; i < serialized.bitArray.length; i++) {
        buffer[headerSize + i] = serialized.bitArray[i];
    }

    await fs.writeFile(filePath, buffer);
}

export async function loadBloomFilter(filePath: string): Promise<BloomFilter | null> {
    try {
        const buffer = await fs.readFile(filePath);

        if (buffer.length < 12) {
            return null;
        }

        const size = buffer.readUInt32LE(0);
        const hashCount = buffer.readUInt32LE(4);
        const addedCount = buffer.readUInt32LE(8);

        const bitArray = Array.from(buffer.slice(12));

        return BloomFilter.deserialize({
            size,
            hashCount,
            addedCount,
            bitArray
        });
    } catch {
        return null;
    }
}

/**
 * Serialized SymbolIndex metadata for quick validation
 */
export interface SymbolIndexMeta {
    totalSymbols: number;
    totalFiles: number;
    symbolKinds: Record<number, number>; // kind → count
}

export async function saveSymbolIndexMeta(meta: SymbolIndexMeta, filePath: string): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(meta), 'utf-8');
}

export async function loadSymbolIndexMeta(filePath: string): Promise<SymbolIndexMeta | null> {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}
