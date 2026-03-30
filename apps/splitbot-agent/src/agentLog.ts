import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.AGENT_LOG_PATH || join(__dirname, '../../../agent_log.json');

type LogEntry = {
  ts: string;
  phase: string;
  action: string;
  detail: string;
  chainTx: string | null;
  explorerUrl?: string;
};

export function appendAgentLog(entry: Omit<LogEntry, 'ts'>) {
  try {
    const full: LogEntry = { ...entry, ts: new Date().toISOString() };
    let data: { entries?: LogEntry[]; agent?: string; schema?: string };
    if (existsSync(LOG_PATH)) {
      data = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
    } else {
      data = { agent: 'SplitBot', schema: 'devspot-agent-log-v1', entries: [] };
    }
    if (!data.entries) data.entries = [];
    data.entries.push(full);
    writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[agent_log] ${full.action} ${full.chainTx || ''}`);
  } catch (e) {
    console.warn('[agent_log] append failed', e);
  }
}
