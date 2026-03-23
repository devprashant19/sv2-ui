import { useTranslatorHealth, useJdcHealth, usePoolData } from './usePoolData';
import { useSetupStatus } from './useSetupStatus';

export interface ConnectionStatus {
  status: 'connected' | 'connecting' | 'disconnected';
  poolName: string | null;
  uptime: number;
}

/**
 * Single source of truth for header connection status.
 * Use this in any page that renders <Shell> to keep the indicator consistent.
 */
export function useConnectionStatus(): ConnectionStatus {
  const { mode: templateMode, poolName } = useSetupStatus();
  const { isJdMode, global: poolGlobal } = usePoolData(templateMode);

  const { data: translatorOk, isLoading: translatorHealthLoading, isError: translatorHealthError } =
    useTranslatorHealth();
  const { data: jdcOk, isLoading: jdcHealthLoading, isError: jdcHealthError } =
    useJdcHealth(isJdMode);

  const translatorHealthy = translatorOk === true && !translatorHealthError;
  const jdcHealthy        = jdcOk === true && !jdcHealthError;
  const isHealthLoading   = translatorHealthLoading || (isJdMode && jdcHealthLoading);
  const isPoolConnected   = isJdMode ? (translatorHealthy && jdcHealthy) : translatorHealthy;

  return {
    status:   isHealthLoading ? 'connecting' : isPoolConnected ? 'connected' : 'disconnected',
    poolName: poolName ?? null,
    uptime:   poolGlobal?.uptime_secs ?? 0,
  };
}
