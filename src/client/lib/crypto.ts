// E2E encryption using Web Crypto API
// No abstractions - direct browser API usage

export interface EncryptedPayload {
  encrypted: true;
  version: 2;  // v2 = compressed + base64
  ephemeralPublicKey: JsonWebKey;
  iv: string;  // base64 (server converts to number[] for backward compat)
  ciphertext: string;  // base64 of encrypted gzip data
}

export interface EncryptedChunk {
  index: number;
  ephemeralPublicKey: JsonWebKey;
  iv: string;
  ciphertext: string;
}

export interface ChunkedEncryptedPayload {
  encrypted: true;
  version: 3;  // v3 = chunked + compressed + base64
  totalChunks: number;
  chunks: EncryptedChunk[];
}

export interface StreamingProgress {
  phase: 'processing' | 'uploading' | 'done';
  currentChunk: number;
  bytesIn: number;  // uncompressed input bytes processed
  totalBytesIn: number; // total input size
  bytesOut: number; // compressed+encrypted bytes sent so far
}

/**
 * Streaming encrypt and upload - processes data in chunks without holding full payload.
 * Flow: JSON → compress → 5MB chunks → encrypt → upload (per chunk)
 * 
 * Returns total chunks uploaded. Server assembles them.
 */
export async function encryptAndUploadStreaming(
  data: EncryptionInput,
  publicKeyJwk: JsonWebKey,
  uploadChunk: (chunk: EncryptedChunk, index: number, isLast: boolean) => Promise<void>,
  onProgress?: (progress: StreamingProgress) => void,
  skipChunks?: number[] // Chunk indices already uploaded (for resume)
): Promise<{ totalChunks: number }> {
  const skipSet = new Set(skipChunks || []);
  // Import recipient's public key once
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Serialize to JSON - we need the string but will stream it
  const jsonString = JSON.stringify(data);
  const totalBytesIn = jsonString.length;
  const encoder = new TextEncoder();
  
  let bytesIn = 0;
  let bytesOut = 0;
  let chunkIndex = 0;
  let buffer = new Uint8Array(0);
  
  // Process JSON in 1MB slices through compression
  const inputChunkSize = 1024 * 1024;
  
  // Helper to process and upload a complete chunk
  const processChunk = async (chunkData: Uint8Array, isLast: boolean) => {
    // Skip if already uploaded (resume case)
    if (skipSet.has(chunkIndex)) {
      console.log(`Skipping chunk ${chunkIndex} (already uploaded)`);
      bytesOut += chunkData.length;
      chunkIndex++;
      return;
    }
    
    onProgress?.({
      phase: 'uploading',
      currentChunk: chunkIndex + 1,
      bytesIn,
      totalBytesIn,
      bytesOut,
    });
    
    const encrypted = await encryptChunk(chunkData, publicKey, chunkIndex);
    await uploadChunk(encrypted, chunkIndex, isLast);
    
    bytesOut += chunkData.length;
    chunkIndex++;
  };
  
  // Stream through compression in slices
  for (let offset = 0; offset < jsonString.length; offset += inputChunkSize) {
    const slice = jsonString.slice(offset, offset + inputChunkSize);
    const sliceBytes = encoder.encode(slice);
    bytesIn = Math.min(offset + inputChunkSize, jsonString.length);
    
    onProgress?.({
      phase: 'processing',
      currentChunk: chunkIndex + 1,
      bytesIn,
      totalBytesIn,
      bytesOut,
    });
    
    // Compress this slice
    const compressed = await compress(sliceBytes);
    
    // Append to buffer
    const newBuffer = new Uint8Array(buffer.length + compressed.length);
    newBuffer.set(buffer);
    newBuffer.set(compressed, buffer.length);
    buffer = newBuffer;
    
    // Process complete chunks
    while (buffer.length >= CHUNK_SIZE) {
      const chunk = buffer.slice(0, CHUNK_SIZE);
      buffer = buffer.slice(CHUNK_SIZE);
      await processChunk(chunk, false);
    }
    
    // Yield to UI
    await new Promise(r => setTimeout(r, 0));
  }
  
  // Upload final chunk if any remaining data
  if (buffer.length > 0) {
    await processChunk(buffer, true);
  }
  
  onProgress?.({
    phase: 'done',
    currentChunk: chunkIndex,
    bytesIn: totalBytesIn,
    totalBytesIn,
    bytesOut,
  });
  
  return { totalChunks: chunkIndex };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

export async function exportPrivateKey(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.privateKey);
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
}

export interface EncryptionInput {
  name: string;
  fhirBaseUrl: string;
  connectedAt: string;
  fhir: unknown;
  attachments?: unknown;
}

export async function encryptData(
  data: EncryptionInput,
  publicKeyJwk: JsonWebKey
): Promise<EncryptedPayload> {
  // Import recipient's public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Generate ephemeral keypair for this encryption
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  // Export ephemeral public key to send with ciphertext
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    ephemeralKeyPair.publicKey
  );

  // Derive shared secret
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Compress, then encrypt the full payload including metadata
  // This ensures server never sees any PHI or identifying info
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(data));
  
  // Compress with gzip using CompressionStream API
  const compressed = await compress(jsonBytes);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    compressed.buffer as ArrayBuffer
  );

  return {
    encrypted: true,
    version: 2,
    ephemeralPublicKey: ephemeralPublicKeyJwk,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

// Chunk size: 5MB of compressed data per chunk
const CHUNK_SIZE = 5 * 1024 * 1024;

export interface ChunkProgress {
  phase: 'compressing' | 'encrypting' | 'done';
  currentChunk: number;
  totalChunks: number;  // May be 0 during streaming (unknown until done)
  bytesProcessed: number;
  totalBytes: number;
}

/**
 * Encrypt a single chunk of compressed data.
 */
async function encryptChunk(
  compressedData: Uint8Array,
  publicKey: CryptoKey,
  index: number
): Promise<EncryptedChunk> {
  // Generate ephemeral keypair for this chunk
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    ephemeralKeyPair.publicKey
  );
  
  // Derive shared secret
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    compressedData.buffer as ArrayBuffer
  );
  
  return {
    index,
    ephemeralPublicKey: ephemeralPublicKeyJwk,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Encrypt data using streaming compression → chunking → encryption.
 * 
 * Flow: JSON string → gzip stream → collect into 5MB chunks → encrypt each chunk
 * 
 * Benefits:
 * - Better compression (gzip sees full data context)
 * - Low memory (streams through, never holds full data)
 * - Each chunk independently encrypted with own ephemeral key
 */
export async function encryptDataChunked(
  data: EncryptionInput,
  publicKeyJwk: JsonWebKey,
  onProgress?: (progress: ChunkProgress) => void
): Promise<ChunkedEncryptedPayload> {
  // Import recipient's public key once
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Serialize to JSON and get total size for progress
  const jsonString = JSON.stringify(data);
  const totalBytes = jsonString.length;
  const encoder = new TextEncoder();
  
  // Create readable stream from JSON string
  const jsonStream = new ReadableStream({
    start(controller) {
      // Stream in chunks to avoid holding full encoded data
      const chunkSize = 1024 * 1024; // 1MB at a time
      let offset = 0;
      
      function pushChunk() {
        if (offset >= jsonString.length) {
          controller.close();
          return;
        }
        const slice = jsonString.slice(offset, offset + chunkSize);
        controller.enqueue(encoder.encode(slice));
        offset += chunkSize;
        
        // Report progress during compression phase
        onProgress?.({
          phase: 'compressing',
          currentChunk: 0,
          totalChunks: 0,
          bytesProcessed: Math.min(offset, jsonString.length),
          totalBytes,
        });
        
        // Yield to allow UI updates
        setTimeout(pushChunk, 0);
      }
      pushChunk();
    }
  });
  
  // Pipe through gzip compression
  const compressedStream = jsonStream.pipeThrough(new CompressionStream('gzip'));
  
  // Collect compressed data into chunks and encrypt each
  const reader = compressedStream.getReader();
  const encryptedChunks: EncryptedChunk[] = [];
  let buffer = new Uint8Array(0);
  let chunkIndex = 0;
  let compressedBytes = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    
    if (value) {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
      compressedBytes += value.length;
    }
    
    // Process complete chunks
    while (buffer.length >= CHUNK_SIZE) {
      const chunk = buffer.slice(0, CHUNK_SIZE);
      buffer = buffer.slice(CHUNK_SIZE);
      
      onProgress?.({
        phase: 'encrypting',
        currentChunk: chunkIndex + 1,
        totalChunks: 0, // Unknown until done
        bytesProcessed: compressedBytes,
        totalBytes,
      });
      
      const encrypted = await encryptChunk(chunk, publicKey, chunkIndex);
      encryptedChunks.push(encrypted);
      chunkIndex++;
      
      // Yield to allow GC and UI updates
      await new Promise(r => setTimeout(r, 0));
    }
    
    if (done) break;
  }
  
  // Encrypt any remaining data in buffer
  if (buffer.length > 0) {
    onProgress?.({
      phase: 'encrypting',
      currentChunk: chunkIndex + 1,
      totalChunks: chunkIndex + 1,
      bytesProcessed: compressedBytes,
      totalBytes,
    });
    
    const encrypted = await encryptChunk(buffer, publicKey, chunkIndex);
    encryptedChunks.push(encrypted);
    chunkIndex++;
  }
  
  const totalChunks = encryptedChunks.length;
  
  onProgress?.({
    phase: 'done',
    currentChunk: totalChunks,
    totalChunks,
    bytesProcessed: totalBytes,
    totalBytes,
  });
  
  return {
    encrypted: true,
    version: 3,
    totalChunks,
    chunks: encryptedChunks,
  };
}

/**
 * Choose encryption method based on data size.
 * Uses chunked encryption for large payloads (>5MB JSON).
 */
export async function encryptDataAuto(
  data: EncryptionInput,
  publicKeyJwk: JsonWebKey,
  onProgress?: (progress: ChunkProgress) => void
): Promise<EncryptedPayload | ChunkedEncryptedPayload> {
  const jsonSize = JSON.stringify(data).length;
  
  if (jsonSize > CHUNK_SIZE) {
    return encryptDataChunked(data, publicKeyJwk, onProgress);
  }
  
  // Small payload - use v2 encryption
  onProgress?.({ phase: 'encrypting', currentChunk: 1, totalChunks: 1, bytesProcessed: 0, totalBytes: jsonSize });
  const result = await encryptData(data, publicKeyJwk);
  onProgress?.({ phase: 'done', currentChunk: 1, totalChunks: 1, bytesProcessed: jsonSize, totalBytes: jsonSize });
  return result;
}
