export type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
};

export class UsageTokenUtils {
  static normalizeUsageTokens(
    usage?: UsageLike | null,
    totalUsage?: UsageLike | null
  ): { inputTokens: number; outputTokens: number; totalTokens: number } | null {
    const primary = usage ?? totalUsage ?? null;
    const inputTokens =
      primary?.inputTokens ??
      primary?.promptTokens ??
      totalUsage?.inputTokens ??
      totalUsage?.promptTokens ??
      0;
    const outputTokens =
      primary?.outputTokens ??
      primary?.completionTokens ??
      totalUsage?.outputTokens ??
      totalUsage?.completionTokens ??
      0;
    let totalTokens = primary?.totalTokens ?? totalUsage?.totalTokens ?? inputTokens + outputTokens;

    if (totalTokens > 0 && (inputTokens > 0 || outputTokens > 0)) {
      totalTokens = inputTokens + outputTokens;
    }

    if (totalTokens > 0 && inputTokens === 0 && outputTokens === 0) {
      return { inputTokens: totalTokens, outputTokens: 0, totalTokens };
    }

    if (totalTokens === 0 && (inputTokens > 0 || outputTokens > 0)) {
      totalTokens = inputTokens + outputTokens;
    }

    if (totalTokens === 0) return null;

    return { inputTokens, outputTokens, totalTokens };
  }
}
