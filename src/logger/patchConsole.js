'use strict';

const {LEVELS} = require('./levels');

/**
 * patchConsole(Log, defaultTag)
 *
 * Replaces the global console.* methods so that all console output
 * in the app goes through the configured Log channels — same formatting,
 * same level filtering, same file output.
 *
 * Safe: ConsoleChannel writes via process.stdout.write / process.stderr.write,
 * never via console.*, so there is no recursion risk.
 *
 * Called once from LogServiceProvider.boot() when interceptConsole is enabled.
 * Returns a restore() function that puts the originals back.
 *
 * Level mapping:
 *   console.log   → Log.i  (INFO)
 *   console.info  → Log.i  (INFO)
 *   console.warn  → Log.w  (WARN)
 *   console.error → Log.e  (ERROR)
 *   console.debug → Log.d  (DEBUG)
 *   console.trace → Log.v  (VERBOSE)
 *   console.dir   → Log.d  (DEBUG)
 */
function patchConsole(Log, defaultTag = 'App') {

    // Save originals — restore() puts these back
    const originals = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
        trace: console.trace.bind(console),
        dir: console.dir.bind(console),
    };

    // Build a dispatcher for a given level
    function make(level) {
        return function (...args) {
            const {message, context, error} = parse(args);
            Log._emit({
                level,
                tag: defaultTag,
                message: message || '',
                context,
                error,
                timestamp: new Date().toISOString(),
                pid: process.pid,
            });
            return true
        };
    }

    console.log = make(LEVELS.INFO);
    console.info = make(LEVELS.INFO);
    console.warn = make(LEVELS.WARN);
    console.error = make(LEVELS.ERROR);
    console.debug = make(LEVELS.DEBUG);
    console.trace = make(LEVELS.VERBOSE);
    console.dir = (obj) => Log._emit({
        level: LEVELS.DEBUG,
        tag: defaultTag,
        message: '',
        context: obj,
        error: undefined,
        timestamp: new Date().toISOString(),
        pid: process.pid
    });

    return function restore() {
        Object.assign(console, originals);
    };
}

// ── Argument parser ───────────────────────────────────────────────────────────
//
// Handles the main shapes people pass to console.*:
//
//   console.log('message')
//   console.log('message', { ctx })
//   console.log('message', error)
//   console.error(error)
//   console.log({ obj })
//   console.log('x:', 42)          → message: 'x: 42'
//   console.log('a', 'b', 'c')     → message: 'a b c'

function parse(args) {
    if (args.length === 0) {
        return {message: '', context: undefined, error: undefined};
    }

    if (args.length === 1) {
        const a = args[0];
        if (a instanceof Error) return {message: a.message, context: undefined, error: a};
        if (typeof a === 'object' && a !== null) return {message: '', context: a, error: undefined};
        return {message: String(a), context: undefined, error: undefined};
    }

    const [first, ...rest] = args;

    // First arg is an Error
    if (first instanceof Error) {
        return {message: first.message, context: rest.length ? rest : undefined, error: first};
    }

    // First arg is a string message
    if (typeof first === 'string') {
        // Single extra arg
        if (rest.length === 1) {
            const r = rest[0];
            if (r instanceof Error) return {message: first, context: undefined, error: r};
            if (typeof r === 'object' && r !== null) return {message: first, context: r, error: undefined};
            // Scalar extra: append to message (console.log('count:', 42))
            return {message: first + ' ' + String(r), context: undefined, error: undefined};
        }

        // Multiple extra args — find a trailing Error, collect the rest as context
        const lastArg = rest[rest.length - 1];
        if (lastArg instanceof Error) {
            const ctx = rest.slice(0, -1);
            return {message: first, context: ctx.length ? ctx : undefined, error: lastArg};
        }

        // All strings/scalars — join into message
        if (rest.every(r => typeof r !== 'object' || r === null)) {
            return {message: [first, ...rest].map(String).join(' '), context: undefined, error: undefined};
        }

        // Mixed — put extras in context
        return {message: first, context: rest, error: undefined};
    }

    // First arg is an object
    if (typeof first === 'object' && first !== null) {
        return {message: '', context: first, error: undefined};
    }

    // Fallback — join everything as a string
    return {message: args.map(String).join(' '), context: undefined, error: undefined};
}

module.exports = patchConsole;
