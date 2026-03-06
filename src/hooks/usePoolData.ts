import { useQuery } from '@tanstack/react-query';
import type { 
  GlobalInfo, 
  ServerChannelsResponse, 
  Sv1ClientsResponse,
  ClientsResponse,
  ClientChannelsResponse,
  ExtendedChannelInfo,
  StandardChannelInfo,
} from '@/types/api';

/**
 * Aggregated client channels data
 */
export interface AggregatedClientChannels {
  total_extended: number;
  total_standard: number;
  extended_channels: ExtendedChannelInfo[];
  standard_channels: StandardChannelInfo[];
}

/**
 * Template mode from configuration.
 * - 'jd': JD Client mode (JDC + Translator)
 * - 'no-jd': Translator-only mode
 */
export type TemplateMode = 'jd' | 'no-jd' | null;

/**
 * Detect if we're in development mode (Vite dev server).
 * In dev mode, we use Vite's proxy to avoid CORS issues.
 * In production (embedded UI), we use absolute URLs.
 */
const isDev = import.meta.env.DEV;

/**
 * Get endpoint configuration.
 * 
 * In DEVELOPMENT (npm run dev):
 *   Uses Vite proxy paths (/jdc-api, /translator-api) to avoid CORS
 * 
 * In PRODUCTION (embedded UI or standalone):
 *   Uses absolute URLs from URL params or env vars:
 *   - ?jdc_url=http://192.168.1.10:9091&translator_url=http://192.168.1.10:9092
 *   - VITE_JDC_URL, VITE_TRANSLATOR_URL
 */
function getEndpoints() {
  if (isDev) {
    // Development: use Vite proxy to avoid CORS
    return {
      jdc: {
        base: '/jdc-api/v1',
        label: 'JD Client',
      },
      translator: {
        base: '/translator-api/v1',
        label: 'Translator',
      },
    };
  }
  
  // Production: use absolute URLs
  const urlParams = new URLSearchParams(window.location.search);
  
  const jdcUrl = urlParams.get('jdc_url') 
    || import.meta.env.VITE_JDC_URL 
    || 'http://localhost:9091';
  
  const translatorUrl = urlParams.get('translator_url') 
    || import.meta.env.VITE_TRANSLATOR_URL 
    || 'http://localhost:9092';
  
  return {
    jdc: {
      base: `${jdcUrl}/api/v1`,
      label: 'JD Client',
    },
    translator: {
      base: `${translatorUrl}/api/v1`,
      label: 'Translator',
    },
  };
}

// Cache endpoints (they don't change during runtime)
let cachedEndpoints: ReturnType<typeof getEndpoints> | null = null;

function getEndpointsCached() {
  if (!cachedEndpoints) {
    cachedEndpoints = getEndpoints();
  }
  return cachedEndpoints;
}

/**
 * Fetch data from an endpoint with timeout.
 */
async function fetchWithTimeout<T>(url: string, timeoutMs = 5000): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Convert template mode from config to internal mode.
 * - 'jd' -> 'jdc' (use JDC endpoints)
 * - 'no-jd' or null -> 'translator' (use Translator endpoints)
 */
function templateModeToInternalMode(templateMode: TemplateMode): 'jdc' | 'translator' {
  return templateMode === 'jd' ? 'jdc' : 'translator';
}

/**
 * Fetch all client channels by first getting client list, then fetching each client's channels.
 * Aggregates all channels into a single response.
 */
async function fetchAllClientChannels(baseUrl: string): Promise<AggregatedClientChannels> {
  // First, get the list of clients
  const clientsResponse = await fetchWithTimeout<ClientsResponse>(`${baseUrl}/clients?offset=0&limit=100`);
  
  if (clientsResponse.items.length === 0) {
    return {
      total_extended: 0,
      total_standard: 0,
      extended_channels: [],
      standard_channels: [],
    };
  }
  
  // Fetch channels for each client in parallel
  const channelPromises = clientsResponse.items.map(client =>
    fetchWithTimeout<ClientChannelsResponse>(`${baseUrl}/clients/${client.client_id}/channels?offset=0&limit=100`)
      .catch(() => null) // Handle individual client failures gracefully
  );
  
  const channelResults = await Promise.all(channelPromises);
  
  // Aggregate all channels
  const aggregated: AggregatedClientChannels = {
    total_extended: 0,
    total_standard: 0,
    extended_channels: [],
    standard_channels: [],
  };
  
  for (const result of channelResults) {
    if (result) {
      aggregated.total_extended += result.total_extended;
      aggregated.total_standard += result.total_standard;
      aggregated.extended_channels.push(...result.extended_channels);
      aggregated.standard_channels.push(...result.standard_channels);
    }
  }
  
  return aggregated;
}

/**
 * Hook to fetch Pool connection data.
 * Uses the configured template mode to determine which endpoints to use.
 * 
 * @param templateMode - The configured template mode from useSetupStatus ('jd' | 'no-jd' | null)
 * 
 * Returns both:
 * - serverChannels: upstream connection to Pool (shares, best diff)
 * - clientChannels: downstream clients connecting to JDC/Translator (for Dashboard)
 */
export function usePoolData(templateMode: TemplateMode = null) {
  const endpoints = getEndpointsCached();
  const mode = templateModeToInternalMode(templateMode);
  
  const baseUrl = mode === 'jdc' ? endpoints.jdc.base : endpoints.translator.base;
  
  // Fetch global stats (includes upstream summary)
  const globalQuery = useQuery({
    queryKey: ['pool-global', mode],
    queryFn: () => fetchWithTimeout<GlobalInfo>(`${baseUrl}/global`),
    refetchInterval: 3000,
  });
  
  // Fetch upstream server channels (Pool connection: shares, best diff)
  const serverChannelsQuery = useQuery({
    queryKey: ['server-channels', mode],
    queryFn: () => fetchWithTimeout<ServerChannelsResponse>(`${baseUrl}/server/channels?offset=0&limit=100`),
    refetchInterval: 3000,
  });
  
  // Fetch downstream client channels (clients connecting to JDC/Translator - for Dashboard)
  const clientChannelsQuery = useQuery({
    queryKey: ['client-channels', mode],
    queryFn: () => fetchAllClientChannels(baseUrl),
    refetchInterval: 3000,
  });
  
  return {
    mode,
    modeLabel: mode === 'jdc' ? endpoints.jdc.label : endpoints.translator.label,
    isJdMode: mode === 'jdc',
    global: globalQuery.data,
    // Server channels = upstream Pool connection
    serverChannels: serverChannelsQuery.data,
    // Client channels = downstream clients (for Dashboard)
    clientChannels: clientChannelsQuery.data,
    // Keep 'channels' as alias for serverChannels for backward compatibility
    channels: serverChannelsQuery.data,
    isLoading: globalQuery.isLoading,
    isError: globalQuery.isError,
    error: globalQuery.error,
  };
}

/**
 * Hook to fetch SV1 clients data.
 * Always fetches from Translator (the only app with SV1 clients).
 */
export function useSv1ClientsData(offset = 0, limit = 25) {
  const endpoints = getEndpointsCached();
  
  return useQuery({
    queryKey: ['sv1-clients', offset, limit],
    queryFn: async () => {
      const response = await fetch(
        `${endpoints.translator.base}/sv1/clients?offset=${offset}&limit=${limit}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json() as Promise<Sv1ClientsResponse>;
    },
    refetchInterval: 3000,
  });
}

/**
 * Hook to fetch Translator health (to show connection status).
 */
export function useTranslatorHealth() {
  const endpoints = getEndpointsCached();
  
  return useQuery({
    queryKey: ['translator-health'],
    queryFn: async () => {
      const response = await fetch(`${endpoints.translator.base}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    },
    refetchInterval: 5000,
    retry: false,
  });
}

/**
 * Hook to fetch JDC health (to show connection status).
 * 
 * @param enabled - Whether to enable the health check (default: true).
 *                  Set to false in No-JD mode to skip probing JDC.
 */
export function useJdcHealth(enabled = true) {
  const endpoints = getEndpointsCached();
  
  return useQuery({
    queryKey: ['jdc-health'],
    queryFn: async () => {
      const response = await fetch(`${endpoints.jdc.base}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    },
    enabled,
    refetchInterval: enabled ? 5000 : false,
    retry: false,
  });
}

/**
 * Get the current endpoint configuration (for display in Settings).
 */
export function getEndpointConfig() {
  return getEndpointsCached();
}
