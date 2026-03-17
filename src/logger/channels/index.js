'use strict';

/**
 * NullChannel
 *
 * Silently discards all log entries.
 * Useful in tests where you want to suppress all output.
 *
 *   Log.configure({ channels: [new NullChannel()] });
 */
class NullChannel {
  write() { /* intentionally empty */ }
}

/**
 * StackChannel
 *
 * Fans a single log entry out to multiple channels simultaneously.
 * This is the standard "stack" pattern — one channel for console,
 * another for file, optionally one for an external service.
 *
 *   new StackChannel([
 *     new ConsoleChannel({ formatter: new PrettyFormatter() }),
 *     new FileChannel({ formatter: new SimpleFormatter(), minLevel: LEVELS.INFO }),
 *   ])
 */
class StackChannel {
  /**
   * @param {Array} channels — array of channel instances
   */
  constructor(channels = []) {
    this._channels = channels;
  }

  /** Add a channel at runtime. */
  add(channel) {
    this._channels.push(channel);
    return this;
  }

  write(entry) {
    for (const ch of this._channels) {
      try { ch.write(entry); } catch {}
    }
  }
}

module.exports = { NullChannel, StackChannel };
