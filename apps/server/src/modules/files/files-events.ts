import { EventEmitter } from 'node:events';
// Internal lifecycle notification only. No credentials or file paths are emitted.
export const filesEvents = new EventEmitter();
