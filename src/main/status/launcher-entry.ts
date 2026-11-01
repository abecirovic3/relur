import fs from 'node:fs';
import net from 'node:net';

/**
 * The launcher badge on Linux (spec §15.5): the count goes out as the
 * `com.canonical.Unity.LauncherEntry.Update` signal on the session bus, which
 * Ubuntu Dock, KDE Plasma, Dash to Dock, Dash to Panel and Plank show on the
 * app's icon. Docks drop a badge when its sender leaves the bus, so the app
 * keeps one connection open rather than running `gdbus emit` each time.
 * Electron's own `app.setBadgeCount` does this only under Unity.
 *
 * Just enough D-Bus for that: EXTERNAL authentication, Hello, and signals,
 * little-endian. Replies from the bus are read and ignored.
 */

/** Where the session bus listens: `unix:path=…` or `unix:abstract=…` (D-Bus address syntax). */
export function sessionBusPath(
  env: NodeJS.ProcessEnv,
  uid: number,
  exists = fs.existsSync,
): string | null {
  for (const address of (env.DBUS_SESSION_BUS_ADDRESS ?? '').split(';')) {
    const [transport, rest = ''] = address.split(/:(.*)/s);
    if (transport !== 'unix') continue;
    const keys = new Map(
      rest.split(',').map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))] as const;
      }),
    );
    const file = keys.get('path');
    if (file) return file;
    const abstract = keys.get('abstract');
    if (abstract) return `\0${abstract}`;
  }
  const standard = `/run/user/${uid}/bus`;
  return exists(standard) ? standard : null;
}

/** A D-Bus value with its type code, for the few types the signal needs. */
type Value =
  | { t: 'y'; v: number }
  | { t: 'u'; v: number }
  | { t: 'b'; v: boolean }
  | { t: 'x'; v: number }
  | { t: 's' | 'o' | 'g'; v: string };

/** Writes D-Bus wire format, aligning against the start of the message. */
class Writer {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  align(n: number): void {
    while (this.bytes.length % n !== 0) this.bytes.push(0);
  }

  byte(v: number): void {
    this.bytes.push(v & 0xff);
  }

  uint32(v: number): void {
    this.align(4);
    for (let i = 0; i < 4; i++) this.bytes.push((v >>> (8 * i)) & 0xff);
  }

  setUint32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.bytes[at + i] = (v >>> (8 * i)) & 0xff;
  }

  int64(v: number): void {
    this.align(8);
    const big = BigInt.asUintN(64, BigInt(v));
    for (let i = 0n; i < 8n; i++) this.bytes.push(Number((big >> (8n * i)) & 0xffn));
  }

  string(v: string): void {
    const data = Buffer.from(v, 'utf8');
    this.uint32(data.length);
    this.bytes.push(...data, 0);
  }

  signature(v: string): void {
    this.byte(v.length);
    this.bytes.push(...Buffer.from(v, 'ascii'), 0);
  }

  value(value: Value): void {
    if (value.t === 'y') this.byte(value.v);
    else if (value.t === 'u') this.uint32(value.v);
    else if (value.t === 'b') this.uint32(value.v ? 1 : 0);
    else if (value.t === 'x') this.int64(value.v);
    else if (value.t === 'g') this.signature(value.v);
    else this.string(value.v);
  }

  variant(value: Value): void {
    this.signature(value.t);
    this.value(value);
  }

  /** An array: its byte length, then the elements aligned to `elementAlign`. */
  array(elementAlign: number, write: () => void): void {
    this.uint32(0);
    const lengthAt = this.length - 4;
    this.align(elementAlign);
    const start = this.length;
    write();
    this.setUint32(lengthAt, this.length - start);
  }

  buffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

/** Header field codes. */
const FIELD = { path: 1, interface: 2, member: 3, destination: 6, signature: 8 } as const;

interface Message {
  type: 'call' | 'signal';
  serial: number;
  path: string;
  iface: string;
  member: string;
  destination?: string;
  signature?: string;
  body?: (w: Writer) => void;
}

/** One D-Bus message, little-endian. */
export function encodeMessage(message: Message): Buffer {
  const body = new Writer();
  message.body?.(body);
  const head = new Writer();
  head.byte('l'.charCodeAt(0));
  head.byte(message.type === 'call' ? 1 : 4);
  head.byte(message.type === 'signal' ? 1 : 0); // signals expect no reply
  head.byte(1);
  head.uint32(body.length);
  head.uint32(message.serial);
  const fields: [number, Value][] = [
    [FIELD.path, { t: 'o', v: message.path }],
    [FIELD.interface, { t: 's', v: message.iface }],
    [FIELD.member, { t: 's', v: message.member }],
  ];
  if (message.destination) fields.push([FIELD.destination, { t: 's', v: message.destination }]);
  if (message.signature) fields.push([FIELD.signature, { t: 'g', v: message.signature }]);
  head.array(8, () => {
    for (const [code, value] of fields) {
      head.align(8);
      head.byte(code);
      head.variant(value);
    }
  });
  head.align(8);
  return Buffer.concat([head.buffer(), body.buffer()]);
}

/** The Update signal for an app's launcher entry: its count, shown when above 0. */
export function launcherUpdate(serial: number, appUri: string, count: number): Buffer {
  return encodeMessage({
    type: 'signal',
    serial,
    path: '/com/canonical/unity/launcherentry/1',
    iface: 'com.canonical.Unity.LauncherEntry',
    member: 'Update',
    signature: 'sa{sv}',
    body: (w) => {
      w.string(appUri);
      w.array(8, () => {
        const entries: [string, Value][] = [
          ['count', { t: 'x', v: count }],
          ['count-visible', { t: 'b', v: count > 0 }],
        ];
        for (const [key, value] of entries) {
          w.align(8);
          w.string(key);
          w.variant(value);
        }
      });
    },
  });
}

/**
 * Keeps one session bus connection and sends the launcher count over it.
 * Connects on the first update and again after the bus went away; without a
 * session bus it does nothing (the window title still carries the count).
 */
export class LauncherBadge {
  private socket: net.Socket | null = null;
  private ready = false;
  private serial = 1;
  private count = 0;

  constructor(
    /** `application://<desktop file id>`, which docks match against their launchers. */
    private readonly appUri: string,
    private readonly busPath: string | null,
    private readonly uid: number,
  ) {}

  set(count: number): void {
    this.count = count;
    if (this.ready && this.socket) {
      this.socket.write(launcherUpdate(this.serial++, this.appUri, count));
    } else if (!this.socket) {
      this.connect();
    }
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.ready = false;
  }

  private connect(): void {
    if (!this.busPath) return;
    const socket = net.connect({ path: this.busPath });
    this.socket = socket;
    let auth = '';
    const onAuth = (chunk: Buffer) => {
      auth += chunk.toString('latin1');
      if (!auth.includes('\r\n')) return;
      socket.off('data', onAuth);
      if (!auth.startsWith('OK ')) return this.close();
      socket.write('BEGIN\r\n');
      socket.write(
        encodeMessage({
          type: 'call',
          serial: this.serial++,
          path: '/org/freedesktop/DBus',
          iface: 'org.freedesktop.DBus',
          member: 'Hello',
          destination: 'org.freedesktop.DBus',
        }),
      );
      this.ready = true;
      // Replies and signals from the bus aren't needed; read them so they don't pile up.
      socket.on('data', () => {});
      socket.write(launcherUpdate(this.serial++, this.appUri, this.count));
    };
    socket.on('data', onAuth);
    socket.on('error', () => this.close());
    socket.on('close', () => {
      if (this.socket === socket) this.close();
    });
    const hexUid = Buffer.from(String(this.uid), 'ascii').toString('hex');
    socket.write(`\0AUTH EXTERNAL ${hexUid}\r\n`);
  }
}
