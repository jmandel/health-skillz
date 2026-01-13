// Brand/provider types matching the existing JSON format

export interface BrandEndpoint {
  url: string;
  name: string;
  connectionType?: string;
}

export interface BrandItem {
  id: string;
  displayName: string;
  brandName: string;
  city?: string;
  state?: string;
  postalCode?: string;
  itemType: 'brand' | 'facility';
  brandId: string;
  brandRef?: string;
  endpoints: BrandEndpoint[];
  searchName: string; // lowercase, pre-computed for fast search
}

export interface BrandFile {
  items: BrandItem[];
  processedTimestamp: string;
}

export interface VendorConfig {
  clientId: string;
  scopes: string;
  redirectUrl?: string;
  brandFiles: string[];
  tags: string[];
}

// Extended vendor config from server (includes redirectUrl derived from config)
export interface ServerVendorConfig extends VendorConfig {
  // The server adds this from config.json
}

export interface LoadProgress {
  phase: 'fetching' | 'parsing' | 'ready';
  bytesLoaded: number;
  totalBytes?: number;
}
