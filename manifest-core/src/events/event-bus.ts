export type EventHandler = (data?: any) => void | Promise<void>;

export class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  public on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  public async emit(event: string, data?: any): Promise<void> {
    const list = this.handlers.get(event) || [];
    for (const h of list) {
      await h(data);
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}
