import { execFileSync } from 'child_process';
import * as pty from 'node-pty';
import { AgentConfig } from '../utils/config';

const BATCH_INTERVAL_MS = 16;   // ~60fps output batching
const RING_BUFFER_SIZE  = 1024 * 1024; // 1 MB disconnect buffer

export type OutputCallback = (data: string, seq: number) => void;

/**
 * 解析可执行文件路径：若为裸命令名则解析为绝对路径。
 * node-pty 的 posix_spawnp 需要绝对路径，不会自动搜索 PATH。
 * - Unix/macOS: 使用 which
 * - Windows: 使用 where（等效于 which）
 */
function resolveExecutablePath(command: string): string {
  if (command.includes('/') || (process.platform === 'win32' && command.includes('\\'))) {
    return command;
  }

  if (process.platform === 'win32') {
    return resolveExecutablePathWindows(command);
  }
  return resolveExecutablePathUnix(command);
}

function resolveExecutablePathUnix(command: string): string {
  try {
    const resolved = execFileSync('which', [command], { encoding: 'utf8' }).trim();
    return resolved || command;
  } catch {
    return command;
  }
}

function resolveExecutablePathWindows(command: string): string {
  try {
    const resolved = execFileSync('where', [command], { encoding: 'utf8' }).trim();
    // where 可能返回多行（PATH 中多个匹配），取第一行（实际执行的那个）
    const first = resolved.split(/\r?\n/)[0]?.trim();
    return first || command;
  } catch {
    return command;
  }
}

export class PtyManager {
  private ptyProcess: pty.IPty | null = null;
  private seq = 0;
  private batchTimer: NodeJS.Timeout | null = null;
  private batchBuffer = '';
  private ringBuffer: string[] = [];
  private ringBufferBytes = 0;
  private onOutput: OutputCallback;
  private onDetectPrompt: (data: string) => void;

  constructor(onOutput: OutputCallback, onDetectPrompt: (data: string) => void) {
    this.onOutput = onOutput;
    this.onDetectPrompt = onDetectPrompt;
  }

  spawn(config: AgentConfig): void {
    if (this.ptyProcess) return;

    const executablePath = resolveExecutablePath(config.claudePath);
    try {
      this.ptyProcess = pty.spawn(executablePath, [], {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: config.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: 'en_US.UTF-8',
        } as { [key: string]: string },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[error] 无法启动 Claude CLI: ${msg}`);
      console.error(`  尝试路径: ${executablePath}`);
      console.error('  请确保已安装 Claude CLI，或通过 --claude-path 指定可执行文件路径');
      console.error('  示例: yarn dev:terminal -- --claude-path /path/to/claude');
      throw err;
    }

    this.ptyProcess.onData((data: string) => {
      // Feed prompt detector
      this.onDetectPrompt(data);

      // Append to ring buffer for reconnect catch-up
      this.appendToRing(data);

      // Batch output into ~60fps frames
      this.batchBuffer += data;
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          const chunk = this.batchBuffer;
          this.batchBuffer = '';
          this.batchTimer = null;
          this.onOutput(chunk, ++this.seq);
        }, BATCH_INTERVAL_MS);
      }
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      console.log(`\n[pty] Claude CLI exited with code ${exitCode}`);
      this.ptyProcess = null;
    });
  }

  write(data: string): void {
    this.ptyProcess?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(cols, rows);
    } catch {
      // Ignore resize errors (process may have exited)
    }
  }

  isAlive(): boolean {
    return this.ptyProcess !== null;
  }

  /** Returns buffered output accumulated during disconnect, then clears it. */
  flushRingBuffer(): string {
    const data = this.ringBuffer.join('');
    this.ringBuffer = [];
    this.ringBufferBytes = 0;
    return data;
  }

  destroy(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    try { this.ptyProcess?.kill(); } catch { /* ignore */ }
    this.ptyProcess = null;
  }

  private appendToRing(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8');
    this.ringBuffer.push(data);
    this.ringBufferBytes += bytes;
    // Evict oldest chunks if over limit
    while (this.ringBufferBytes > RING_BUFFER_SIZE && this.ringBuffer.length > 0) {
      const evicted = this.ringBuffer.shift()!;
      this.ringBufferBytes -= Buffer.byteLength(evicted, 'utf8');
    }
  }
}
