import { EventEmitter } from 'node:events';

export type FindingPayload = {
    id: string;
    repoFullName: string;
    prNumber: number;
    category: string;
    filePath: string;
    description: string;
    lineStart?: number | undefined;
    lineEnd?: number | undefined;
    firstSeenAt?: string | undefined;
    lastSeenAt?: string | undefined;
};

export type AppEvent =
    | { type: 'finding-created'; userId: string; payload: FindingPayload }
    | { type: 'finding-updated'; userId: string; payload: FindingPayload }
    | {
          type: 'repo-config-updated';
          userId: string;
          payload: { repoFullName: string; action: 'created' | 'updated' | 'deleted' };
      }
    | {
          type: 'installation-linked';
          userId: string;
          payload: { installationId: string; accountLogin: string };
      };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const CHANNEL = 'app';

export function publish(event: AppEvent): void {
    emitter.emit(CHANNEL, event);
}

export type Unsubscribe = () => void;

/**
 * Subscribe to events for a specific user. The listener fires only when event.userId matches.
 */
export function subscribe(userId: string, listener: (event: AppEvent) => void): Unsubscribe {
    const handler = (event: AppEvent): void => {
        if (event.userId === userId) {
            listener(event);
        }
    };
    emitter.on(CHANNEL, handler);
    return () => emitter.off(CHANNEL, handler);
}
