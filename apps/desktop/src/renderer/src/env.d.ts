/// <reference types="vite/client" />
import type { CommonsApi } from "@commons/shared";

declare global {
  interface Window {
    commons: CommonsApi;
  }
}

export {};
