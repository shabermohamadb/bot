export type ServiceStatus = 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';

interface SystemState {
  database: ServiceStatus;
  discord: ServiceStatus;
  realtime: ServiceStatus;
  startTime: number;
}

const state: SystemState = {
  database: 'connecting',
  discord: 'connecting',
  realtime: 'connecting',
  startTime: Date.now(),
};

export function setDatabaseStatus(status: ServiceStatus): void {
  state.database = status;
}

export function setDiscordStatus(status: ServiceStatus): void {
  state.discord = status;
}

export function setRealtimeStatus(status: ServiceStatus): void {
  state.realtime = status;
}

export function getSystemHealth() {
  return {
    status: 'ok',
    service: 'discord-raid-master',
    uptime: Math.floor((Date.now() - state.startTime) / 1000),
    database: state.database,
    discord: state.discord,
    realtime: state.realtime,
    timestamp: new Date().toISOString(),
  };
}
