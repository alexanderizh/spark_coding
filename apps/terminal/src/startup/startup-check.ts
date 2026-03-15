import axios from 'axios';
import { execFileSync } from 'child_process';
import { AgentConfig } from '../utils/config';

interface CheckResult {
  ok: boolean;
  message: string;
}

export interface StartupCheckResults {
  claudeCli: CheckResult;
  server: CheckResult;
}

function checkClaudeCli(config: AgentConfig): CheckResult {
  try {
    const output = execFileSync(config.claudePath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    const version = output.split(/\r?\n/)[0] || '版本未知';
    return {
      ok: true,
      message: `已安装 Claude CLI（${version}）`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `未检测到可用的 Claude CLI（${message}）`,
    };
  }
}

async function checkServer(config: AgentConfig): Promise<CheckResult> {
  try {
    const response = await axios.options(`${config.serverUrl}/api/session`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    if (response.status >= 500) {
      return {
        ok: false,
        message: `服务端异常（HTTP ${response.status}）`,
      };
    }
    return {
      ok: true,
      message: `服务端可访问（HTTP ${response.status}）`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `无法连接服务端（${message}）`,
    };
  }
}

export async function runStartupChecks(config: AgentConfig): Promise<StartupCheckResults> {
  const [claudeCli, server] = await Promise.all([Promise.resolve(checkClaudeCli(config)), checkServer(config)]);
  return { claudeCli, server };
}
