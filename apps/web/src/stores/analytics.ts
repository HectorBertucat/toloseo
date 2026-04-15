import { createStore } from "solid-js/store";
import type {
  AnalyticsSummary,
  DelayByHour,
  ReliabilityScore,
  TrendData,
} from "@shared/types";

interface AnalyticsState {
  summary: AnalyticsSummary | null;
  delayByHour: DelayByHour[];
  reliability: ReliabilityScore[];
  trends: TrendData[];
  loading: boolean;
  error: string | null;
}

const initialState: AnalyticsState = {
  summary: null,
  delayByHour: [],
  reliability: [],
  trends: [],
  loading: false,
  error: null,
};

const [analyticsState, setAnalyticsState] =
  createStore<AnalyticsState>(initialState);

function setLoading(loading: boolean): void {
  setAnalyticsState("loading", loading);
}

function setError(error: string | null): void {
  setAnalyticsState("error", error);
}

function setSummary(summary: AnalyticsSummary): void {
  setAnalyticsState("summary", summary);
}

function setDelayByHour(data: DelayByHour[]): void {
  setAnalyticsState("delayByHour", data);
}

function setReliability(data: ReliabilityScore[]): void {
  setAnalyticsState("reliability", data);
}

function setTrends(data: TrendData[]): void {
  setAnalyticsState("trends", data);
}

export {
  analyticsState,
  setLoading,
  setError,
  setSummary,
  setDelayByHour,
  setReliability,
  setTrends,
};
