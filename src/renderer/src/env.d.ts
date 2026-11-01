import type { PreloadBridge } from '@shared/bridge';

declare global {
  interface Window {
    bridge: PreloadBridge;
  }
}
