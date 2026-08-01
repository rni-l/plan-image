import { useParams } from "react-router-dom";

const STEPS = [
  { n: 1, label: "选择配置"     },
  { n: 2, label: "设计方向"     },
  { n: 3, label: "编辑方案"     },
  { n: 4, label: "生成与导出"   },
] as const;

export function TaskWizard() {
  const { taskId, step } = useParams<{ taskId: string; step: string }>();
  const currentStep = Number(step ?? 1);

  return (
    <div className="px-8 py-8">
      {/* Step indicator */}
      <ol className="mb-10 flex items-center gap-0">
        {STEPS.map(({ n, label }, i) => {
          const done    = n < currentStep;
          const active  = n === currentStep;
          return (
            <li key={n} className="flex items-center">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    active
                      ? "bg-zinc-900 text-white"
                      : done
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-300 text-zinc-400"
                  }`}
                >
                  {n}
                </span>
                <span className={`text-sm ${active ? "font-medium text-zinc-900" : "text-zinc-400"}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span className="mx-3 h-px w-8 bg-zinc-200" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step content placeholder */}
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-zinc-400">
          任务 {taskId} — Step {currentStep}
        </p>
      </div>
    </div>
  );
}
