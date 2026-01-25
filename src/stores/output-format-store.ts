// src/stores/output-format-store.ts

import { create } from 'zustand';
import { DEFAULT_OUTPUT_FORMAT, type OutputFormatType } from '@/types/output-format';

interface OutputFormatState {
  outputFormat: OutputFormatType;
  setOutputFormat: (format: OutputFormatType) => void;
}

export const useOutputFormatStore = create<OutputFormatState>((set) => ({
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  setOutputFormat: (format) => set({ outputFormat: format }),
}));
