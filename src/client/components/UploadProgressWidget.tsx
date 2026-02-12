export interface ProviderUploadState {
  providerName: string;
  /** Pre-estimated chunk count from data size */
  estimatedChunks: number;
  /** Refined once upload finishes (actual count) */
  actualChunks: number | null;
  /** Chunks confirmed uploaded */
  chunksUploaded: number;
  /** Chunks skipped (resume) */
  chunksSkipped: number;
  /** Bytes of input processed so far */
  bytesIn: number;
  /** Total input bytes */
  totalBytesIn: number;
  /** Compressed+encrypted bytes out for this provider */
  bytesOut: number;
  /** Phase for this provider */
  status: 'pending' | 'active' | 'done';
  /** Current chunk being processed (1-based) */
  currentChunk: number;
  /** Sub-phase of current chunk */
  chunkPhase: 'processing' | 'uploading' | 'done';
}

export interface UploadProgress {
  providers: ProviderUploadState[];
  /** Index of the provider currently being uploaded */
  activeProviderIndex: number;
  /** Overall phase */
  phase: 'uploading' | 'finalizing' | 'done';
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

type DotStatus = 'pending' | 'skipped' | 'processing' | 'uploading' | 'done';

function ChunkDot({ status }: { status: DotStatus }) {
  return <div className={`up-dot up-${status}`} />;
}

function ProviderRow({ state }: { state: ProviderUploadState }) {
  const numDots = state.actualChunks ?? state.estimatedChunks;
  const pct = state.totalBytesIn > 0
    ? Math.round((state.bytesIn / state.totalBytesIn) * 100)
    : state.status === 'done' ? 100 : 0;

  const dots: DotStatus[] = [];
  for (let i = 0; i < numDots; i++) {
    if (i < state.chunksSkipped) {
      dots.push('skipped');
    } else if (i < state.chunksUploaded + state.chunksSkipped) {
      dots.push('done');
    } else if (state.status === 'active' && i === state.chunksUploaded + state.chunksSkipped) {
      dots.push(state.chunkPhase === 'uploading' ? 'uploading' : 'processing');
    } else {
      dots.push('pending');
    }
  }
  if (state.status === 'done') dots.fill('done');

  return (
    <div className={`up-provider${state.status === 'pending' ? ' up-provider-pending' : ''}`}>
      <div className="up-provider-header">
        <span className="up-provider-name">{state.providerName}</span>
        {state.status === 'done' && <span className="up-provider-check">✓</span>}
      </div>
      <div className="up-dot-strip">
        {dots.map((s, i) => <ChunkDot key={i} status={s} />)}
      </div>
      <div className="fp-ref-bar">
        <div className="fp-ref-bar-track">
          <div className="fp-ref-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="fp-ref-bar-count">{pct}%</span>
      </div>
    </div>
  );
}

export default function UploadProgressWidget({ progress }: { progress: UploadProgress }) {
  const { providers, phase } = progress;
  const isDone = phase === 'done';
  const isFinalizing = phase === 'finalizing';
  const totalBytesOut = providers.reduce((sum, p) => sum + p.bytesOut, 0);

  // Active provider status text
  const active = providers.find(p => p.status === 'active');
  const statusText = isDone
    ? null
    : isFinalizing
    ? 'Finalizing session…'
    : active
    ? active.chunkPhase === 'processing'
      ? 'Compressing & encrypting…'
      : `Uploading chunk ${active.currentChunk}`
    : null;

  return (
    <div className="up-widget">
      {/* Hero: total bytes sent */}
      <div className="up-hero">
        <div className={`up-hero-num${isDone ? ' up-complete' : ''}`}>
          {fmtBytes(totalBytesOut)}
        </div>
        <div className="up-hero-label">
          {isDone ? 'encrypted & sent' : isFinalizing ? 'finalizing…' : 'encrypted & uploading'}
        </div>
      </div>

      {/* One row per provider */}
      <div className="up-providers">
        {providers.map((p, i) => <ProviderRow key={i} state={p} />)}
      </div>

      {/* Status */}
      {statusText && <div className="up-status">{statusText}</div>}
    </div>
  );
}
