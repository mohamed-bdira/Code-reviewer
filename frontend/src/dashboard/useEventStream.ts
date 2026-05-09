import { useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../auth/apiFetch';

export type ServerEvent =
    | { type: 'finding-created'; payload: unknown }
    | { type: 'finding-updated'; payload: unknown }
    | { type: 'repo-config-updated'; payload: unknown }
    | { type: 'installation-linked'; payload: unknown };

export type ServerEventType = ServerEvent['type'];

const EVENT_TYPES: ServerEventType[] = [
    'finding-created',
    'finding-updated',
    'repo-config-updated',
    'installation-linked',
];

/**
 * Opens an EventSource against /api/events using ?token= (EventSource cannot set headers).
 * Prefers service API key when set, otherwise session JWT — same rule as apiFetch.
 */
export function useEventStream(sessionToken: string | null, serviceKey: string | null): {
    lastEvent: ServerEvent | null;
    connected: boolean;
} {
    const [lastEvent, setLastEvent] = useState<ServerEvent | null>(null);
    const [connected, setConnected] = useState<boolean>(false);
    const streamToken = serviceKey ?? sessionToken;
    const streamTokenRef = useRef(streamToken);
    streamTokenRef.current = streamToken;

    useEffect(() => {
        if (!streamToken) {
            setConnected(false);
            return;
        }

        const url = `${getApiBaseUrl()}/api/events?token=${encodeURIComponent(streamToken)}`;
        const es = new EventSource(url);
        let alive = true;

        es.addEventListener('open', () => {
            if (alive) setConnected(true);
        });
        es.addEventListener('error', () => {
            if (alive) setConnected(false);
        });

        for (const t of EVENT_TYPES) {
            es.addEventListener(t, (rawEvent) => {
                if (!alive) return;
                const ev = rawEvent as MessageEvent<string>;
                let payload: unknown = null;
                try {
                    payload = JSON.parse(ev.data);
                } catch {
                    payload = ev.data;
                }
                setLastEvent({ type: t, payload } as ServerEvent);
            });
        }

        return () => {
            alive = false;
            es.close();
        };
    }, [streamToken]);

    return { lastEvent, connected };
}
