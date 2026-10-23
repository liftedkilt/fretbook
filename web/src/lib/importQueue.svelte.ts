import { SvelteSet } from "svelte/reactivity";
import type { Job } from "./types";

export interface ClientJob extends Job {
  isClient?: boolean;
}

class ImportQueueState {
  clientJobs = $state<ClientJob[]>([]);
  trackedServerJobIds = new SvelteSet<string>();
  lastServerRefresh = $state<number>(0);

  trackJobIds(ids: string[]): void {
    for (const id of ids) this.trackedServerJobIds.add(id);
    this.lastServerRefresh = Date.now();
  }

  untrackJobId(id: string): void {
    this.trackedServerJobIds.delete(id);
  }

  notifyServerJobs(): void {
    this.lastServerRefresh = Date.now();
  }

  addJob(job: ClientJob): void {
    this.clientJobs.push(job);
  }

  updateJob(id: string, updates: Partial<ClientJob>): void {
    const idx = this.clientJobs.findIndex((j) => j.id === id);
    if (idx !== -1) {
      this.clientJobs[idx] = { ...this.clientJobs[idx], ...updates };
    }
  }

  dismissJob(id: string): void {
    this.clientJobs = this.clientJobs.filter((j) => j.id !== id);
  }

  dismissAll(): void {
    this.clientJobs = [];
    this.trackedServerJobIds.clear();
  }
}

export const importQueue = new ImportQueueState();

export function getClientJobs(): ClientJob[] {
  return importQueue.clientJobs;
}

export function addClientJob(job: ClientJob): void {
  importQueue.addJob(job);
}

export function updateClientJob(id: string, updates: Partial<ClientJob>): void {
  importQueue.updateJob(id, updates);
}

export function dismissClientJob(id: string): void {
  importQueue.dismissJob(id);
}

export function dismissAllClientJobs(): void {
  importQueue.dismissAll();
}
