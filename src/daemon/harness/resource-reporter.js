'use strict';

const { execFile } = require('child_process');
const { logger } = require('../lib/logger');

/**
 * Reports resource usage per harness app and infrastructure service.
 * P3-71, P3-72, P3-73
 */
class ResourceReporter {
  /**
   * Get resource usage for all running containers.
   * Returns CPU%, memory, and disk usage per container.
   */
  async getAll() {
    try {
      const output = await this._dockerStats();
      return this._parseStats(output);
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to get resource stats');
      return [];
    }
  }

  /**
   * Get resource usage for a specific app.
   */
  async getForApp(appName) {
    const all = await this.getAll();
    return all.find(s => s.name === appName || s.container.includes(appName)) || null;
  }

  /**
   * Get total system resource usage.
   */
  async getSystemSummary() {
    const all = await this.getAll();
    const totalMemMb = all.reduce((sum, s) => sum + (s.memoryMb || 0), 0);
    const totalCpuPct = all.reduce((sum, s) => sum + (s.cpuPercent || 0), 0);

    // Get disk usage
    let diskUsed = 0;
    let diskTotal = 0;
    try {
      const df = await this._exec(['sh', '-c', "df -m / | tail -1 | awk '{print $3, $2}'"]);
      const parts = df.trim().split(/\s+/);
      diskUsed = parseInt(parts[0], 10) || 0;
      diskTotal = parseInt(parts[1], 10) || 0;
    } catch { /* ignore */ }

    return {
      containers: all.length,
      totalMemoryMb: Math.round(totalMemMb),
      totalCpuPercent: Math.round(totalCpuPct * 100) / 100,
      diskUsedMb: diskUsed,
      diskTotalMb: diskTotal,
      diskPercent: diskTotal ? Math.round(diskUsed / diskTotal * 100) : 0,
      // P3-72: Warning at 85%
      warnings: diskTotal && (diskUsed / diskTotal) > 0.85
        ? ['Disk usage above 85%']
        : [],
    };
  }

  /**
   * Get docker stats in JSON format.
   */
  _dockerStats() {
    return new Promise((resolve, reject) => {
      execFile('docker', ['stats', '--no-stream', '--format',
        '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'],
      { timeout: 15_000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }

  /**
   * Parse docker stats output.
   */
  _parseStats(output) {
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, cpu, mem, memPct, net, block] = line.split('\t');
      const memMatch = (mem || '').match(/([\d.]+)(MiB|GiB|KiB)/);
      let memoryMb = 0;
      if (memMatch) {
        memoryMb = parseFloat(memMatch[1]);
        if (memMatch[2] === 'GiB') memoryMb *= 1024;
        if (memMatch[2] === 'KiB') memoryMb /= 1024;
      }

      return {
        name: name || '',
        container: name || '',
        cpuPercent: parseFloat((cpu || '').replace('%', '')) || 0,
        memoryMb: Math.round(memoryMb * 10) / 10,
        memoryPercent: parseFloat((memPct || '').replace('%', '')) || 0,
        networkIO: net || '',
        blockIO: block || '',
      };
    });
  }

  /**
   * Execute a shell command.
   */
  _exec(command) {
    return new Promise((resolve, reject) => {
      execFile(command[0], command.slice(1), { timeout: 10_000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }
}

module.exports = { ResourceReporter };
