export interface GuideProduct { id: string; name: string; updatedAt: string }
export interface GuideTask { id: string; productId: string; productName: string; currentStep: number; updatedAt: string }
export interface GuideExamples {
  product: Pick<GuideProduct, "id" | "name"> | null;
  task: Pick<GuideTask, "id" | "productId" | "currentStep"> | null;
}

export interface GuideLinks {
  product: string;
  research: string;
  task: string;
  export: string;
}

export const GUIDE_ROUTE = "/guide";

export function selectGuideExamples(products: GuideProduct[], tasks: GuideTask[]): GuideExamples {
  const product = selectLatest(products);
  const task = product
    ? selectLatest(tasks.filter((item) => item.productId === product.id))
    : selectLatest(tasks);
  return {
    product: product ? { id: product.id, name: product.name } : null,
    task: task ? { id: task.id, productId: task.productId, currentStep: task.currentStep } : null,
  };
}

function selectLatest<T extends { updatedAt: string }>(items: T[]): T | undefined {
  return items.reduce<T | undefined>((latest, item) => (
    !latest || timestamp(item.updatedAt) > timestamp(latest.updatedAt) ? item : latest
  ), undefined);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function buildGuideLinks(examples: GuideExamples): GuideLinks {
  return {
    product: examples.product ? "/products/" + examples.product.id + "/info" : "/products",
    research: examples.product ? "/products/" + examples.product.id + "/research" : "/products",
    task: examples.product ? "/products/" + examples.product.id + "/tasks" : "/products",
    export: examples.task ? "/tasks/" + examples.task.id + "/step/" + examples.task.currentStep : "/task-center",
  };
}
