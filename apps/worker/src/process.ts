import { spawn, type ChildProcess } from 'node:child_process';

const running = new Set<ChildProcess>();

/** Startet ein Programm, ruft onLine für jede Ausgabezeile auf und wirft bei Exit-Code != 0. */
export function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    let tail = '';
    const handle = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      if (onLine) for (const line of text.split(/[\r\n]+/)) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => {
      running.delete(child);
      reject(new Error(`${cmd} konnte nicht gestartet werden: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (code === 0) resolve(tail);
      else reject(new Error(`${cmd} beendet mit ${signal ?? `Code ${code}`}:\n${tail.trim().split('\n').slice(-8).join('\n')}`));
    });
  });
}

export function killAll() {
  for (const child of running) child.kill('SIGTERM');
}
