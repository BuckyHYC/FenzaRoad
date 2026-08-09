export const Events = {
  MODE_CHANGED: 'mode:changed',
  RACE_COUNTDOWN: 'race:countdown',
  RACE_LAP: 'race:lap',
  RACE_POSITION: 'race:position',
  RACE_FINISHED: 'race:finished',
  VEHICLE_COLLISION: 'vehicle:collision',
  GARAGE_SELECTED: 'garage:selected',
  AUDIO_MUTE: 'audio:mute',
} as const;

type EventListener = (data?: unknown) => void;

class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  on(event: string, listener: EventListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: EventListener): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit(event: string, data?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch (error) {
        console.error(`EventBus error [${event}]:`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
