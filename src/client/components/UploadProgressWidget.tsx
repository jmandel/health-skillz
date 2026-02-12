import type { StreamingProgress } from '../lib/crypto';

export interface UploadProgress {
  /** Which provider we're currently uploading */
  providerName: string;
  /** Index in the list of selected connections (0-based) */
  providerIndex: number;
  /** Total providers to upload */
  providerCount: number;
  /** Streaming progress from the crypto layer */
  streaming: StreamingProgress;
  /** Total chunks expected (estimated from data size, refined as we go) */
  totalChunks: number | null;
  /** Chunks already confirmed uploaded */
  chunksUploaded: number;
  /** Chunks skipped (resume) */
  chunksSkipped: number;
  /** Overall phase */
  phase: 'encrypting' | 'uploading' | 'finalizing' | 'done';
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function ChunkDot({ status }: { status: 'pending' | 'skipped' | 'processing' | 'uploading' | 'done' }) {
  const cls = {
    pending: 'up-dot up-pending',
    skipped: 'up-dot up-skipped',
    processing: 'up-dot up-processing',
    uploading: 'up-dot up-uploading',
    done: 'up-dot up-done',
  }[status];
  return <div className={cls} />;
}

export default function UploadProgressWidget({ progress }: { progress: UploadProgress }) {
  const { providerName, providerIndex, providerCount, streaming, totalChunks,
          chunksUploaded, chunksSkipped, phase } = progress;

  const isDone = phase === 'done';
  const isFinalizing = phase === 'finalizing';

  // Bytes progress
  const pctBytes = streaming.totalBytesIn > 0
    ? Math.round((streaming.bytesIn / streaming.totalBytesIn) * 100)
    : 0;

  // Build chunk dots
  const numChunks = totalChunks ?? streaming.currentChunk;
  const dots: ('pending' | 'skipped' | 'processing' | 'uploading' | 'done')[] = [];
  for (let i = 0; i < numChunks; i++) {
    if (i < chunksSkipped) {
      dots.push('skipped');
    } else if (i < chunksUploaded) {
      dots.push('done');
    } else if (i === chunksUploaded) {
      dots.push(streaming.phase === 'uploading' ? 'uploading' : 'processing');
    } else {
      dots.push('pending');
    }
  }
  if (isDone) dots.fill('done');

  // Provider label
  const provLabel = providerCount > 1
    ? `${providerName} (${providerIndex + 1}/${providerCount})`
    : providerName;

  return (
    <div className="up-widget">
      {/* Hero: bytes sent */}
      <div className="up-hero">
        <div className={`up-hero-num${isDone ? ' up-complete' : ''}`}>
          {fmtBytes(streaming.bytesOut)}
        </div>
        <div className="up-hero-label">
          {isDone ? 'encrypted & sent' : isFinalizing ? 'finalizing session…' : 'encrypted & uploading'}
        </div>
      </div>

      {/* Chunk dots */}
      {dots.length > 0 && (
        <div className="up-dot-strip">
          {dots.map((s, i) => <ChunkDot key={i} status={s} />)}
        </div>
      )}

      {/* Progress bar */}
      <div className="up-bar-section">
        <div className="fp-ref-bar">
          <span className="fp-ref-bar-label">{provLabel}</span>
          <div className="fp-ref-bar-track">
            <div className="fp-ref-bar-fill" style={{ width: `${pctBytes}%` }} />
          </div>
          <span className="fp-ref-bar-count">{pctBytes}%</span>
        </div>
      </div>

      {/* Status */}
      {!isDone && !isFinalizing && (
        <div className="up-status">
          {streaming.phase === 'processing' ? 'Compressing & encrypting…' : `Uploading chunk ${streaming.currentChunk}`}
          {chunksSkipped > 0 && ` (${chunksSkipped} resumed)`}
        </div>
      )}
    </div>
  );
}
