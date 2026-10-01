/**
 * Manifest Core v0.1 - Event System
 * Event dispatching architecture for WHEN blocks and future extensions.
 */

export type EventHandler = (payload?: unknown) => void | Promise<void>;

export class EventBus {
  private readonly handlers: Map<string, EventHandler[]> = new Map();

  /**
   * Registers a handler for a specific event name (e.g. 'app.starts').
   */
  public on(eventName: string, handler: EventHandler): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  /**
   * Emits an event, executing all registered handlers in order.
   */
  public async emit(eventName: string, payload?: unknown): Promise<void> {
    const list = this.handlers.get(eventName);
    if (!list || list.length === 0) return;

    for (const handler of list) {
      await handler(payload);
    }
  }

  /**
   * Checks if any handlers are registered for an event.
   */
  public hasListeners(eventName: string): boolean {
    const list = this.handlers.get(eventName);
    return Boolean(list && list.length > 0);
  }

  /**
   * Returns list of all registered event names.
   */
  public getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clears all registered handlers.
   */
  public clear(): void {
    this.handlers.clear();
  }
}
