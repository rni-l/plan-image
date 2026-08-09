export interface GuideProduct { id: string; name: string; updatedAt: number }
export interface GuideTask { id: string; productId: string; productName: string; currentStep: number; updatedAt: number }
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
  const product = [...products].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const matchedTask = product ? tasks.filter((item) => item.productId === product.id).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined;
  const task = matchedTask ?? [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return {
    product: product ? { id: product.id, name: product.name } : null,
    task: task ? { id: task.id, productId: task.productId, currentStep: task.currentStep } : null,
  };
}

export function buildGuideLinks(examples: GuideExamples): GuideLinks {
  return {
    product: examples.product ? "/products/" + examples.product.id + "/info" : "/products",
    research: examples.product ? "/products/" + examples.product.id + "/research" : "/products",
    task: examples.product ? "/products/" + examples.product.id + "/tasks" : "/products",
    export: examples.task ? "/tasks/" + examples.task.id + "/step/" + examples.task.currentStep : "/task-center",
  };
}
