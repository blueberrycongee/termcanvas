export type TaskStatus = "open" | "done" | "dropped";

export interface TaskLink {
  type: string;
  url: string;
  id?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  repo: string;
  body: string;
  links: TaskLink[];
  created: string;
  updated: string;
}

export interface CreateTaskInput {
  title: string;
  repo: string;
  body?: string;
  status?: TaskStatus;
  links?: TaskLink[];
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  body?: string;
  links?: TaskLink[];
}
