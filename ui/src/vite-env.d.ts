/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway WebSocket URL */
  readonly VITE_GATEWAY_URL: string;
  /** Cloud Backend API URL */
  readonly VITE_CLOUD_BACKEND_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
