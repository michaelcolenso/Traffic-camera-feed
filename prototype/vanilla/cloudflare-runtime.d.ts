interface RequestInit {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
    image?: {
      width?: number;
      fit?: 'scale-down';
      quality?: number;
      format?: 'avif' | 'webp';
    };
  };
}

interface Env {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}
